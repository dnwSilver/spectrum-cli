const { fs, path, temp, remove } = require('../../src/automation');
const { cliIdentity } = require('../../src/automation/tooling');
const { trigger } = require('../../src/sbom/resolve');
const cli = { schemaVersion: 1, source: 'git', ref: 'feature/cli', sha: 'c'.repeat(40), version: '6.2.0' };
let root;
beforeEach(() => { root = temp('tooling-identity-'); });
afterEach(() => { remove(root); jest.restoreAllMocks(); });
test('CLI identity remains optional for standalone catalogue clients', () => {
  expect(cliIdentity({})).toBeUndefined();
  expect(cliIdentity({ SPECTRUM_CLI_IDENTITY: JSON.stringify(cli) })).toEqual(cli);
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
