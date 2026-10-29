const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Git operations are real; avoid downloading a formatter in the fixture repository.
jest.mock('../src/common/utils', () => {
  const actual = jest.requireActual('../src/common/utils');
  return {
    ...actual,
    execSilent: jest.fn((command) => command === 'npx --yes prettier --version' ? '3.0.0' : actual.execSilent(command)),
    execCommand: jest.fn((command) => command.startsWith('npx --yes prettier ') ? true : actual.execCommand(command)),
  };
});
const utils = require('../src/common/utils');
const { releaseStart } = require('../src/release');
const { resolveReleaseState } = require('../src/changelog/open-release');
const { withCommandOptions } = require('../src/cli/command-executor');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
const block = (version, entry, type = '🪲 Fixed') => `## 🚀 [${version}] - 2026-09-24\n\n### ${type}\n\n- ${entry}\n`;

describe('repeated release start against a real temporary origin', () => {
  let root, work, origin, cwd;
  function commit(message) { git(work, 'add', '.'); git(work, 'commit', '-m', message); }
  function fragment(name, entry) {
    fs.mkdirSync(path.join(work, '.changelog'), { recursive: true });
    fs.writeFileSync(path.join(work, '.changelog', name), `- ${entry}\n`);
    commit(name);
  }
  beforeEach(() => {
    cwd = process.cwd();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectrum-repeat-'));
    work = path.join(root, 'work'); origin = path.join(root, 'origin.git');
    fs.mkdirSync(work);
    git(root, 'init', '--bare', origin);
    git(work, 'init', '--initial-branch=master');
    git(work, 'config', 'user.name', 'Release Test');
    git(work, 'config', 'user.email', 'release-test@example.com');
    git(work, 'remote', 'add', 'origin', origin);
    fs.writeFileSync(path.join(work, 'CHANGELOG.md'), '# Changelog\n\n' + block('1.0.0', 'Published.'));
    commit('Initial stable');
    git(work, 'tag', 'v1.0.0');
    git(work, 'push', '-u', 'origin', 'master', '--tags');
    git(work, 'switch', '-c', 'dev');
    git(work, 'push', '-u', 'origin', 'dev');
    process.chdir(work);
    utils.execCommand.mockImplementation((command) => command.startsWith('npx --yes prettier ') ? true : jest.requireActual('../src/common/utils').execCommand(command));
  });
  afterEach(() => { process.chdir(cwd); fs.rmSync(root, { recursive: true, force: true }); });

  test.each([
    ['multiple versions above the cached stable tag', block('1.1.0', 'Older release.') + block('1.0.0', 'Published.')],
    ['legacy history sections', '## Legend\n\nKeep this historical explanation.\n\n' + block('1.1.0', 'Older release.')]
  ])('no-verify extends only the top release with %s', async (_name, tail) => {
    const text = '# Changelog\n\n' + block('1.2.0', 'Existing top note.') + '\n' + tail;
    fs.writeFileSync('CHANGELOG.md', text);
    fragment('fix.fixed.md', 'New correction.');
    const head = git(work, 'rev-parse', 'HEAD');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await releaseStart()).toBe(false);
      expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
      expect(fs.readFileSync('CHANGELOG.md', 'utf8')).toBe(text);
      expect(await withCommandOptions({ verify: false }, releaseStart)).toBe(true);
      const result = fs.readFileSync('CHANGELOG.md', 'utf8');
      expect(result).toContain('## 🚀 [1.2.0] - 2026-09-24');
      expect(result).toContain('Existing top note.');
      expect(result).toContain('New correction.');
      expect(result.endsWith(tail)).toBe(true);
      expect(fs.readdirSync('.changelog')).toEqual([]);
      expect(git(origin, 'show', 'master:CHANGELOG.md')).toBe(result.trim());
      expect(await withCommandOptions({ verify: false }, releaseStart)).toBe(true);
      expect(fs.readFileSync('CHANGELOG.md', 'utf8')).toBe(result);
    } finally {
      log.mockRestore();
    }
  });

  test('no-verify assembles and extends a release despite dirty files and changed production history', async () => {
    fragment('fix.fixed.md', 'First fix.');
    fs.writeFileSync('CHANGELOG.md', fs.readFileSync('CHANGELOG.md', 'utf8').replace('Published.', 'Edited history.'));
    fs.writeFileSync('local-untracked', 'unrelated work');
    git(work, 'branch', 'hotfix/TASK-1-1.0.1');
    utils.execCommand.mockClear();
    utils.execSilent.mockClear();
    expect(await withCommandOptions({ verify: false }, releaseStart)).toBe(true);
    expect(fs.readFileSync('CHANGELOG.md', 'utf8')).toContain('## 🚀 [1.0.1]');
    expect(fs.readFileSync('CHANGELOG.md', 'utf8')).toContain('Edited history.');
    expect(git(origin, 'rev-parse', 'master')).toBe(git(origin, 'rev-parse', 'dev'));
    expect(fs.readFileSync('local-untracked', 'utf8')).toBe('unrelated work');
    expect(utils.execCommand.mock.calls.some(([command]) => command.startsWith('git fetch'))).toBe(false);
    expect(utils.execSilent.mock.calls.some(([command]) => command.includes('ls-remote') || command.startsWith('git show'))).toBe(false);

    fs.writeFileSync('.changelog/second.fixed.md', '- Second fix.\n');
    expect(await withCommandOptions({ verify: false }, releaseStart)).toBe(true);
    const text = fs.readFileSync('CHANGELOG.md', 'utf8');
    expect(text).toContain('First fix.');
    expect(text).toContain('Second fix.');
    expect(text).not.toContain('[1.0.2]');
    expect(fs.readdirSync('.changelog')).toEqual([]);
    const head = git(work, 'rev-parse', 'HEAD');
    expect(await withCommandOptions({ verify: false }, releaseStart)).toBe(true);
    expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
  });

  test('no-verify does not treat a newer version below the top release as the active block', async () => {
    const text = '# Changelog\n\n' + block('1.0.0', 'Published.') + '\n' + block('1.1.0', 'Out-of-order history.');
    fs.writeFileSync('CHANGELOG.md', text);
    fragment('fix.fixed.md', 'New correction.');
    expect(await withCommandOptions({ verify: false }, releaseStart)).toBe(true);
    const result = fs.readFileSync('CHANGELOG.md', 'utf8');
    expect(result.match(/^## .+$/gm)[0]).toContain('[1.0.1]');
    expect(result.endsWith(text.slice(text.indexOf('## ')))).toBe(true);
    expect(result).toContain('New correction.');
    expect(git(origin, 'show', 'master:CHANGELOG.md')).toBe(result.trim());
  });

  test('appends new notes to master release, keeps version/date, removes fragments, then starts next version after tag', async () => {
    fragment('feature.added.md', 'Original feature.');
    expect(await releaseStart()).toBe(true);
    const first = fs.readFileSync('CHANGELOG.md', 'utf8');
    const heading = first.split('\n').find(line => line.startsWith('## '));
    fragment('followup.breaking.md', 'New breaking note.');
    fragment('duplicate.added.md', 'Original feature.');
    expect(await releaseStart()).toBe(true);
    const text = fs.readFileSync('CHANGELOG.md', 'utf8');
    expect(text.split('\n').find(line => line.startsWith('## '))).toBe(heading);
    expect(text.match(/Original feature\./g)).toHaveLength(1);
    expect(text).toContain('New breaking note.');
    expect(text).toContain(block('1.0.0', 'Published.'));
    expect(fs.readdirSync('.changelog')).toEqual([]);
    expect(git(work, 'status', '--porcelain')).toBe('');
    expect(git(origin, 'show', 'master:CHANGELOG.md')).toBe(text.trim());
    expect(git(origin, 'rev-parse', 'master')).toBe(git(origin, 'rev-parse', 'dev'));
    const head = git(work, 'rev-parse', 'HEAD');
    expect(await releaseStart()).toBe(true);
    expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
    git(work, 'tag', 'release/1.1.0'); git(work, 'push', 'origin', 'refs/tags/release/1.1.0');
    fragment('next.fixed.md', 'Next release.');
    expect(await releaseStart()).toBe(true);
    expect(fs.readFileSync('CHANGELOG.md', 'utf8')).toContain('## 🚀 [1.1.1]');
  });

  test('appends to an undated open release without adding a date', async () => {
    fragment('fix.fixed.md', 'First correction.');
    expect(await releaseStart()).toBe(true);
    const first = fs.readFileSync('CHANGELOG.md', 'utf8');
    const undated = first.replace(/(## 🚀 \[1\.0\.1\]) - \d{4}-\d{2}-\d{2}/, '$1');
    fs.writeFileSync('CHANGELOG.md', undated);
    commit('Keep pending release undated');
    git(work, 'push', 'origin', 'HEAD:master');
    fragment('another.fixed.md', 'Second correction.');
    expect(await releaseStart()).toBe(true);
    const text = fs.readFileSync('CHANGELOG.md', 'utf8');
    expect(text).toContain('## 🚀 [1.0.1]\n');
    expect(text).not.toContain('[1.0.1] -');
    expect(text).toContain('First correction.');
    expect(text).toContain('Second correction.');
    expect(text).toContain(block('1.0.0', 'Published.'));
  });

  test('retains production notes even when a dev edit removed them', async () => {
    fragment('feature.added.md', 'Keep production note.');
    expect(await releaseStart()).toBe(true);
    fs.writeFileSync('CHANGELOG.md', fs.readFileSync('CHANGELOG.md', 'utf8').replace('Keep production note.', 'Local note.'));
    commit('Edit pending notes');
    fragment('fix.fixed.md', 'New fix.');
    expect(await releaseStart()).toBe(true);
    const text = fs.readFileSync('CHANGELOG.md', 'utf8');
    for (const entry of ['Keep production note.', 'Local note.', 'New fix.']) expect(text).toContain(entry);
  });

  test('retries a failed push after fragments have already been collapsed', async () => {
    fragment('fix.fixed.md', 'Fix.');
    utils.execCommand.mockImplementation(command => command.startsWith('git push --atomic') ? false : command.startsWith('npx --yes prettier ') ? true : jest.requireActual('../src/common/utils').execCommand(command));
    expect(await releaseStart()).toBe(false);
    expect(fs.readdirSync('.changelog')).toEqual([]);
    const head = git(work, 'rev-parse', 'HEAD');
    utils.execCommand.mockImplementation(command => command.startsWith('npx --yes prettier ') ? true : jest.requireActual('../src/common/utils').execCommand(command));
    expect(await releaseStart()).toBe(true);
    expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(origin, 'rev-parse', 'master')).toBe(head);
  });

  test('does not delete fragments when formatting fails', async () => {
    fragment('fix.fixed.md', 'Fix.');
    utils.execCommand.mockImplementation(command => command.startsWith('npx --yes prettier --write') ? false : command.startsWith('npx --yes prettier ') ? true : jest.requireActual('../src/common/utils').execCommand(command));
    expect(await releaseStart()).toBe(false);
    expect(fs.existsSync('.changelog/fix.fixed.md')).toBe(true);
    expect(git(origin, 'show', 'master:CHANGELOG.md')).not.toContain('[1.0.1]');
  });
});

describe('open release reconciliation', () => {
  const history = '# Changelog\n\n' + block('1.0.0', 'Published.');
  test('compares CRLF working tree history against LF production blobs', () => {
    const checkout = history.replace(/\n/g, '\r\n');
    expect(resolveReleaseState(checkout, history, '1.0.0').openReleaseVersion).toBeNull();
    expect(() => resolveReleaseState(checkout.replace('Published.', 'Changed.'), history, '1.0.0')).toThrow(/история/);
  });
  test('preserves the existing migration from legacy Unreleased headings', () => {
    const legacy = history.replace('# Changelog\n\n', '# Changelog\n\n## [Unreleased]\n\n### Added\n\n');
    expect(resolveReleaseState(legacy, history, '1.0.0').openReleaseVersion).toBeNull();
  });
  test('rejects mismatched versions, multiple pending headings and published history edits', () => {
    expect(() => resolveReleaseState('# Changelog\n\n'+block('1.2.0','Local.'), '# Changelog\n\n'+block('1.1.0','Remote.'), '1.0.0')).toThrow(/различаются/);
    expect(() => resolveReleaseState('# Changelog\n\n'+block('1.2.0','One.')+block('1.1.0','Two.'), history, '1.0.0')).toThrow(/один открытый/);
    expect(() => resolveReleaseState(history.replace('Published.', 'Changed.'), history, '1.0.0')).toThrow(/история/);
  });
  test('supports wrapped notes and major/minor sections', () => {
    const text = '# Changelog\n\n' + block('1.1.0','Wrapped\n  note.', '🆕 Added') + '\n### 💥 Breaking change\n\n- Breaking.\n\n' + block('1.0.0','Published.');
    const state = resolveReleaseState(text, text, '1.0.0');
    expect(state.openReleaseVersion).toBe('1.1.0');
    expect(state.production.entries[0].entries).toEqual(['- Wrapped note.']);
    expect(state.production.entries[1].type).toBe('breaking');
  });
});
