const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { Bootstrap, identity, installEnv, runInstaller } = require('../ci-bootstrap.cjs');
let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-bootstrap-test-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function packageAt(directory, version = '6.2.1') {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'spectrum-cli', version }));
  fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify({ name: 'spectrum-cli', version, lockfileVersion: 3, packages: { '': { name: 'spectrum-cli', version } } }));
  fs.writeFileSync(path.join(directory, 'index.js'), 'console.log(JSON.stringify({args:process.argv.slice(2),cli:JSON.parse(process.env.SPECTRUM_CLI_IDENTITY)}));process.exit(Number(process.env.TEST_EXIT||0));');
}
function runner(env = {}) {
  const calls = [], output = [], messages = [];
  let latest = '6.2.1';
  const run = jest.fn((command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'npm' && args[0] === 'install') {
      const selector = args.at(-1).replace('spectrum-cli@', '');
      packageAt(path.join(options.cwd, 'node_modules/spectrum-cli'), selector.includes('.') ? selector : latest);
      return { status: 0, stdout: '' };
    }
    return runInstaller(command, args, options);
  });
  const bootstrap = new Bootstrap({ PATH: process.env.PATH, ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT } : {}), SPECTRUM_CLI_CACHE_DIR: path.join(root, 'cache'), ...env }, {
    run, log: value => messages.push(value), child: (command, args, options) => {
      const result = spawnSync(command, args, { ...options, encoding: 'utf8', stdio: 'pipe' });
      output.push(JSON.parse(result.stdout));
      return result;
    },
  });
  return { bootstrap, calls, run, output, messages, latest: value => { latest = value; } };
}
test('major selection freezes the exact npm version across subsequent jobs and preserves child exit status', async () => {
  const file = path.join(root, 'report/cli.json');
  const first = runner({ SPECTRUM_CLI_IDENTITY_FILE: file, SPECTRUM_CLI_VERSION: '6' });
  expect(await first.bootstrap.execute(['security', 'scan'])).toBe(0);
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ schemaVersion: 1, source: 'npm', version: '6.2.1' });
  const next = runner({ SPECTRUM_CLI_IDENTITY_FILE: file, TEST_EXIT: '7' });
  next.latest('6.3.0');
  expect(await next.bootstrap.execute(['security', 'repair', '--silence'])).toBe(7);
  expect(next.calls[0].args.at(-1)).toBe('spectrum-cli@6.2.1');
  expect(next.output[0].args).toEqual(['security', 'repair', '--silence']);
});
test('dry forwards flags and does not create an identity artifact', async () => {
  const file = path.join(root, 'report/cli.json');
  const { bootstrap, output } = runner({ SPECTRUM_CLI_IDENTITY_FILE: file });
  expect(await bootstrap.execute(['security', 'scan', '-ds'])).toBe(0);
  expect(output[0].args).toEqual(['security', 'scan', '-ds']);
  expect(fs.existsSync(file)).toBe(false);
});
test('downstream input overrides local selectors, and conflicting artifact identities fail', async () => {
  const fixed = { schemaVersion: 1, source: 'npm', version: '6.2.1' };
  const file = path.join(root, 'cli.json');
  const { bootstrap, output } = runner({ SPECTRUM_CLI_IDENTITY: JSON.stringify(fixed), SPECTRUM_CLI_VERSION: '7', SPECTRUM_CLI_REF: 'other', SPECTRUM_CLI_IDENTITY_FILE: file });
  expect(await bootstrap.execute(['--version'])).toBe(0);
  expect(output[0].cli).toEqual(fixed);
  fs.writeFileSync(file, JSON.stringify({ ...fixed, version: '6.2.2' }));
  await expect(bootstrap.execute(['--version'])).rejects.toThrow('Conflicting CLI identities');
});
test.each(['https://evil/cli.tgz', '6\n', '--prefix=/tmp', 'npm:other'])('invalid version selector cannot change package/source: %s', async version => {
  const { bootstrap, run } = runner({ SPECTRUM_CLI_VERSION: version });
  await expect(bootstrap.execute(['--version'])).rejects.toThrow('cli_version');
  expect(run).not.toHaveBeenCalled();
});
test('installer credentials are stripped, scripts are disabled, cache is explicit and errors remain useful', async () => {
  const { bootstrap, run } = runner({ OAUTH_SHORT_TOKEN: 'secret', GLAB_BOT_PAT: 'secret-token', NEXUS_PASSWORD: 'password-secret', NODE_AUTH_TOKEN: 'npm-secret', NODE_TLS_REJECT_UNAUTHORIZED: '0' });
  run.mockImplementation((command, args, options) => {
    expect(options.env.GLAB_BOT_PAT).toBeUndefined();
    expect(options.env.NEXUS_PASSWORD).toBeUndefined();
    expect(options.env.NODE_AUTH_TOKEN).toBeUndefined();
    expect(args).toContain('--ignore-scripts');
    expect(args).toContain('--registry=https://registry.npmjs.org/');
    expect(args).toContain('--strict-ssl=true');
    expect(args).toContain('--cache');
    return { status: 1, stderr: '403 Forbidden secret-token' };
  });
  let message;
  try { await bootstrap.execute(['--version']); } catch (error) { message = error.message; }
  expect(message).toContain('403 Forbidden [REDACTED]');
  expect(message).not.toContain('-token');
  expect(installEnv({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }).NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
});
test('older CLI cannot silently lose identity forwarding', async () => {
  const { bootstrap } = runner({ SPECTRUM_CLI_VERSION: '6.1.2' });
  await expect(bootstrap.execute(['security', 'scan'])).rejects.toThrow('requires CLI 6.2.0');
});
function gitFixture() {
  const repo = path.join(root, 'repo'); packageAt(repo);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    if (result.status) throw Error(result.stderr);
    return result.stdout.trim();
  };
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  const archive = spawnSync('git', ['archive', '--format=tar.gz', '--prefix=spectrum-cli-' + sha + '/', 'HEAD'], { cwd: repo }).stdout;
  return { sha, archive };
}
test('branch installs a fixed archive without Git in the installer and remains pinned after the branch advances', async () => {
  const { sha, archive } = gitFixture(), nextSha = 'b'.repeat(40);
  const file = path.join(root, 'cli.json');
  const first = runner({ SPECTRUM_CLI_REF: 'feature/fix', SPECTRUM_CLI_IDENTITY_FILE: file });
  first.bootstrap.fetch = jest.fn(async url => url.includes('/git/ref/') ? { ok: true, json: async () => ({ ref: 'refs/heads/feature/fix', object: { type: 'commit', sha } }) } :
    { ok: true, arrayBuffer: async () => archive });
  expect(await first.bootstrap.execute(['nextjs', 'licenses'])).toBe(0);
  expect(first.output[0].cli.sha).toBe(sha);
  expect(first.calls.every(call => call.command !== 'git')).toBe(true);
  const next = runner({ SPECTRUM_CLI_IDENTITY_FILE: file });
  next.bootstrap.fetch = jest.fn(async url => {
    if (url.includes('/git/ref/')) return { ok: true, json: async () => ({ ref: 'refs/heads/feature/fix', object: { type: 'commit', sha: nextSha } }) };
    if (url.includes('/compare/')) return { ok: true, json: async () => ({ status: 'ahead', merge_base_commit: { sha } }) };
    expect(url).toBe('https://codeload.github.com/dnwSilver/spectrum-cli/tar.gz/' + sha);
    return { ok: true, arrayBuffer: async () => archive };
  });
  expect(await next.bootstrap.execute(['security', 'track'])).toBe(0);
  expect(next.output[0].cli.sha).toBe(sha);
});
test('a forced/mismatched branch cannot substitute code for the frozen commit', async () => {
  const fixed = { schemaVersion: 1, source: 'git', version: '6.2.1', ref: 'main', sha: 'a'.repeat(40) };
  const { bootstrap, run } = runner({ SPECTRUM_CLI_IDENTITY: JSON.stringify(fixed) });
  bootstrap.fetch = async url => ({ ok: true, json: async () => url.includes('/git/ref/') ? { ref: 'refs/heads/main', object: { type: 'commit', sha: 'b'.repeat(40) } } :
    { status: 'diverged', merge_base_commit: { sha: 'c'.repeat(40) } } });
  await expect(bootstrap.execute(['security', 'track'])).rejects.toThrow('no longer on the selected ref');
  expect(run).not.toHaveBeenCalled();
});
test('malformed identities and raw commit selectors are rejected', async () => {
  expect(() => identity({ schemaVersion: 1, source: 'git', ref: 'main', sha: 'not-sha', version: '6.2.0' })).toThrow();
  const { bootstrap } = runner({ SPECTRUM_CLI_REF: 'a'.repeat(40) });
  await expect(bootstrap.execute(['--version'])).rejects.toThrow('named Git branch');
});
test('GitHub rate-limit messages are visible, with no fallback or token disclosure', async () => {
  const token = 'github-read-secret';
  const { bootstrap, run, output } = runner({ SPECTRUM_CLI_REF: 'main', SPECTRUM_CLI_GITHUB_TOKEN: token });
  bootstrap.fetch = jest.fn(async (_, options) => {
    expect(options.headers.Authorization).toBe('Bearer ' + token);
    expect(options.redirect).toBe('error');
    return { ok: false, status: 403, json: async () => ({ message: 'API rate limit exceeded ' + token }) };
  });
  await expect(bootstrap.execute(['--version'])).rejects.toThrow('HTTP 403): API rate limit exceeded [REDACTED]');
  expect(run).not.toHaveBeenCalled();
  expect(output).toEqual([]);
  bootstrap.fetch = jest.fn(async (_, options) => {
    expect(options.headers.Authorization).toBeUndefined();
    return { ok: true, arrayBuffer: async () => Buffer.from('archive') };
  });
  await bootstrap.download('https://codeload.github.com/dnwSilver/spectrum-cli/tar.gz/' + 'a'.repeat(40));
});
test('only actual repository branch/tag refs can resolve, not arbitrary short commit aliases', async () => {
  const { bootstrap, run } = runner({ SPECTRUM_CLI_REF: 'abcdef1' });
  bootstrap.fetch = jest.fn(async url => {
    expect(url).toMatch(/\/git\/ref\/(heads|tags)\/abcdef1$/);
    return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
  });
  await expect(bootstrap.execute(['--version'])).rejects.toThrow('HTTP 404');
  expect(bootstrap.fetch).toHaveBeenCalledTimes(2);
  expect(run).not.toHaveBeenCalled();
});
test('annotated repository tags resolve to their commit before archive download', async () => {
  const { sha, archive } = gitFixture(), tag = 'd'.repeat(40);
  const { bootstrap, output } = runner({ SPECTRUM_CLI_REF: 'v6.2.1' });
  bootstrap.fetch = async url => {
    if (url.includes('/git/ref/heads/')) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    if (url.includes('/git/ref/tags/')) return { ok: true, json: async () => ({ ref: 'refs/tags/v6.2.1', object: { type: 'tag', sha: tag } }) };
    if (url.includes('/git/tags/')) return { ok: true, json: async () => ({ object: { type: 'commit', sha } }) };
    expect(url).toBe('https://codeload.github.com/dnwSilver/spectrum-cli/tar.gz/' + sha);
    return { ok: true, arrayBuffer: async () => archive };
  };
  expect(await bootstrap.execute(['nextjs', 'licenses'])).toBe(0);
  expect(output[0].cli).toMatchObject({ ref: 'v6.2.1', sha });
});
