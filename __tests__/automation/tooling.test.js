const { fs, path, temp, remove, save, read } = require('../../src/automation');
const { cliIdentity, verifyCLI } = require('../../src/automation/tooling');
const { reconcile } = require('../../src/security/tracking');
const { Repairer } = require('../../src/security/repair');
const { trigger } = require('../../src/sbom/resolve');
const cli = { schemaVersion: 1, source: 'git', ref: 'feature/cli', sha: 'c'.repeat(40), version: '6.2.0' };
const config = { project_id: '123', pipeline_id: '1', sha: 'a'.repeat(40), branch: 'master', project_path: 'team/app', pipeline_url: 'https://gitlab.example/pipelines/1' };
let root, stderr;
beforeEach(() => { root = temp('tooling-identity-'); stderr = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { remove(root); jest.restoreAllMocks(); });
const report = () => ({ schemaVersion: 1, config, findings: [{ id: 'CVE-2099-12345', severity: 'HIGH', sources: ['npm'], occurrences: [] }], errors: [], cli });
const env = () => ({ CI_PROJECT_ID: '123', NIGHTLY_TRACKER_PROJECT: 'shared/security', NIGHTLY_COMPONENT_SHA: 'a'.repeat(40),
  NIGHTLY_SCAN_JOB_ID: '10', NIGHTLY_COMPONENT_REFERENCE: 'feature/tracker', SPECTRUM_CLI_IDENTITY: JSON.stringify(cli) });
test('tracker branch selection preserves component SHA verification and forwards the frozen CLI identity', async () => {
  save(path.join(root, 'security-report/findings.json'), report());
  const api = {
    get: jest.fn(async location => location.endsWith('/jobs') ? [{ id: 11, name: 'nightly:track' }] :
      location.includes('/artifacts/') ? Buffer.from(JSON.stringify(report())) : { id: 'a'.repeat(40) }),
    post: jest.fn(async () => ({ id: 1, sha: 'a'.repeat(40), status: 'success' })),
  };
  expect(await reconcile({ cwd: root, env: env(), deps: { api, checkGitlabAccess: async () => ({}) } })).toBe(0);
  expect(api.get).toHaveBeenCalledWith('projects/shared%2Fsecurity/repository/commits/feature%2Ftracker');
  expect(api.post.mock.calls[0][1]).toMatchObject({ ref: 'feature/tracker', inputs: { cli_identity: JSON.stringify(cli) } });
  expect(read(path.join(root, 'security-report/tracked.json')).cli).toEqual(cli);
});
test('a moved tracker branch cannot launch a different component commit', async () => {
  save(path.join(root, 'security-report/findings.json'), report());
  const api = { get: async () => ({ id: 'b'.repeat(40) }), post: jest.fn() };
  expect(await reconcile({ cwd: root, env: env(), deps: { api, checkGitlabAccess: async () => ({}) } })).toBe(1);
  expect(api.post).not.toHaveBeenCalled();
  expect(stderr.mock.calls.flat().join(' ')).toContain('does not match the included component');
});
test('different CLI identities block reconcile and repair before remote writes', async () => {
  const current = { ...env(), SPECTRUM_CLI_IDENTITY: JSON.stringify({ ...cli, sha: 'd'.repeat(40) }) };
  save(path.join(root, 'security-report/findings.json'), report());
  save(path.join(root, 'security-report/tracked.json'), report());
  const api = { post: jest.fn(), get: jest.fn() };
  expect(await reconcile({ cwd: root, env: current, deps: { api } })).toBe(1);
  expect(await new Repairer(current, { api }).repair(root)).toBe(1);
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  expect(stderr.mock.calls.flat().join(' ')).toContain('CLI identity differs');
});
test('catalogue writer request receives the same CLI identity and explicit branch', async () => {
  const transport = jest.fn(async () => ({ status: 201, body: Buffer.from('{"web_url":"https://gitlab.example/pipeline/1"}') }));
  await trigger(['99.1.2'], { CI_SERVER_URL: 'https://gitlab.example', CI_API_V4_URL: 'https://gitlab.example/api/v4',
    CI_JOB_TOKEN: 'job-secret', SBOM_CATALOG_UPDATER_PROJECT: 'team/catalog', SBOM_CATALOG_UPDATER_REF: 'pilot',
    SPECTRUM_CLI_IDENTITY: JSON.stringify(cli) }, transport);
  const body = JSON.parse(transport.mock.calls[0][1].body);
  expect(body.ref).toBe('pilot');
  expect(JSON.parse(body.inputs.cli_identity)).toEqual(cli);
  expect(body.inputs.cli_identity).not.toContain('job-secret');
});
test('legacy reports remain readable while identified reports require the selected CLI', () => {
  expect(cliIdentity({})).toBeUndefined();
  expect(() => verifyCLI({ errors: [] }, {})).not.toThrow();
  expect(() => verifyCLI(report(), {})).toThrow('CLI identity differs');
});
test('catalog partial-version references keep using released tracker tags', async () => {
  save(path.join(root, 'security-report/findings.json'), report());
  const api = {
    get: jest.fn(async location => location.endsWith('/refs') ? [{ name: 'v2.2.0' }] :
      location.endsWith('/jobs') ? [{ id: 11, name: 'nightly:track' }] :
      location.includes('/artifacts/') ? Buffer.from(JSON.stringify(report())) : { id: 'a'.repeat(40) }),
    post: jest.fn(async () => ({ id: 1, sha: 'a'.repeat(40), status: 'success' })),
  };
  expect(await reconcile({ cwd: root, env: { ...env(), NIGHTLY_COMPONENT_REFERENCE: '~latest' },
    deps: { api, checkGitlabAccess: async () => ({}) } })).toBe(0);
  expect(api.post.mock.calls[0][1].ref).toBe('v2.2.0');
});
test('tracker cannot drop the frozen CLI identity from its result', async () => {
  save(path.join(root, 'security-report/findings.json'), report());
  const result = report(); delete result.cli;
  const api = {
    get: async location => location.endsWith('/jobs') ? [{ id: 11, name: 'nightly:track' }] :
      location.includes('/artifacts/') ? Buffer.from(JSON.stringify(result)) : { id: 'a'.repeat(40) },
    post: async () => ({ id: 1, sha: 'a'.repeat(40), status: 'success' }),
  };
  expect(await reconcile({ cwd: root, env: env(), deps: { api, checkGitlabAccess: async () => ({}) } })).toBe(1);
  expect(stderr.mock.calls.flat().join(' ')).toContain('Tracker result CLI identity mismatch');
});
test.each([['pilot', 'true', 0], ['pilot', 'false', 2], ['', 'true', 2]])(
  'writer dry pilot requires an actual protected branch (%s, %s)', async (branch, protectedRef, expected) => {
    const { Publisher } = require('../../src/sbom/populate');
    const bootstrap = jest.fn(async () => {});
    const writer = new Publisher({ CI_COMMIT_BRANCH: branch, CI_COMMIT_REF_PROTECTED: protectedRef,
      SBOM_CATALOG_PUBLISH_REPOSITORY: 'registry.example/catalog', NEXT_CATALOG_VERSIONS: '["99.1.2"]',
      NEXUS_USER: 'writer', NEXUS_PASSWORD: 'secret' }, { bootstrap, checkRegistryAccess: async () => ({}) });
    writer.oras = jest.fn(); writer.publish = jest.fn();
    expect(await writer.main({ cwd: root, dry: true })).toBe(expected);
    expect(bootstrap).toHaveBeenCalledTimes(expected ? 0 : 1);
    expect(writer.publish).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, 'sbom-catalog-updater'))).toBe(false);
  });
