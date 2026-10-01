const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

jest.mock('../../src/common/utils', () => ({
    ...jest.requireActual('../../src/common/utils'),
    execCommand: jest.fn(() => true),
}));
const utils = require('../../src/common/utils');
const preflight = require('../../src/preflight');
const { hotfixStart, hotfixDeploy, hotfixClose } = require('../../src/hotfix');
const { withCommandOptions, withDryRun } = require('../../src/cli/command-executor');

function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

describe('hotfix start with real Git origins', () => {
    let temp, work, origin, cwd, initial, stableText, log;
    const fragment = (name, content = '- TASK-1 Исправлена ошибка.\n') => {
        fs.mkdirSync(path.join(work, '.changelog'), { recursive: true });
        fs.writeFileSync(path.join(work, '.changelog', name), content);
    };
    const contents = () => fs.readFileSync(path.join(work, 'CHANGELOG.md'), 'utf8');
    const commit = (message) => {
        git(work, 'add', '.');
        git(work, 'commit', '-m', message);
    };
    const mergeHotfix = () => {
        commit('Prepare hotfix MR');
        git(work, 'switch', 'master');
        git(work, 'merge', '--no-ff', 'hotfix/TASK-1', '-m', 'Merge hotfix MR');
        git(work, 'push', 'origin', 'master');
    };

    beforeEach(() => {
        cwd = process.cwd();
        temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spectrum-hotfix-test-'));
        work = path.join(temp, 'work');
        origin = path.join(temp, 'origin.git');
        fs.mkdirSync(work);
        git(temp, 'init', '--bare', origin);
        git(work, 'init', '--initial-branch=master');
        git(work, 'config', 'user.name', 'Hotfix Test');
        git(work, 'config', 'user.email', 'test@example.invalid');
        git(work, 'config', 'commit.gpgsign', 'false');
        git(work, 'config', 'tag.gpgsign', 'false');
        git(work, 'remote', 'add', 'origin', origin);
        stableText = '# Changelog\n\n## 🚀 [1.2.3] - 2026-01-01\n\n### 🪲 Fixed\n\n- Published correction.\n';
        fs.writeFileSync(path.join(work, 'CHANGELOG.md'), stableText);
        fs.writeFileSync(path.join(work, 'package.json'), '{"version":"0.0.0"}\n');
        commit('Stable baseline');
        initial = git(work, 'rev-parse', 'HEAD');
        git(work, 'tag', 'v1.2.3');
        git(work, 'push', 'origin', 'master', 'v1.2.3');
        git(work, 'switch', '-c', 'dev');
        fs.writeFileSync(path.join(work, 'unfinished-feature'), 'must not reach master\n');
        fragment('dev-feature.breaking.md', '- Unfinished incompatible feature.\n');
        commit('Unfinished work');
        git(work, 'push', 'origin', 'dev');
        git(work, 'switch', '-c', 'hotfix/TASK-1', 'master');
        process.chdir(work);
        log = jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(preflight, 'getPrettierRunner').mockReturnValue('fixture-prettier');
        utils.execCommand.mockReset().mockReturnValue(true);
    });

    afterEach(() => {
        process.chdir(cwd);
        jest.restoreAllMocks();
        fs.rmSync(temp, { recursive: true, force: true });
    });

    test('start on stale master refuses to overwrite unpublished history', () => {
        git(work, 'switch', 'hotfix/TASK-1');
        fs.writeFileSync('remote-correction', 'production update');
        commit('Concurrent production change');
        git(work, 'push', 'origin', 'HEAD:master');
        git(work, 'switch', 'master');
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(false);
        expect(contents()).toBe(stableText);
        expect(fs.existsSync('.changelog/TASK-1.fixed.md')).toBe(true);
    });

    test.each(['dev', 'feature/TASK-1', 'hotfix/no-task'])('rejects start on %s', (branch) => {
        if (['dev', 'master'].includes(branch)) git(work, 'switch', branch);
        else git(work, 'switch', '-c', branch);
        const before = contents();
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(false);
        expect(contents()).toBe(before);
        expect(fs.existsSync('.changelog/TASK-1.fixed.md')).toBe(true);
    });

    test.each([
        ['TASK-1.added.md', '- New feature.\n'],
        ['TASK-1.breaking.md', '- Incompatible change.\n'],
        ['TASK-1.removed.md', '- Removed old API.\n'],
        ['TASK-1.unknown.md', '- Unknown.\n'],
        ['TASK-1.fixed.md', 'Invalid line.\n'],
        ['TASK-1.fixed.md', ''],
    ])('rejects invalid or non-patch fragment %s', (name, content) => {
        fragment(name, content);
        expect(hotfixStart()).toBe(false);
        expect(contents()).toBe(stableText);
        expect(fs.readFileSync(`.changelog/${name}`, 'utf8')).toBe(content);
    });

    test.each(['master', 'hotfix/TASK-1'])('collects all current fragments on %s regardless of Git history', (branch) => {
        git(work, 'switch', 'master');
        fragment('already-in-production.fixed.md', '- Existing correction.\n');
        fragment('long-note.changed.md', `- ${'x'.repeat(150)}\n`);
        commit('Pending changelog fragments');
        git(work, 'push', 'origin', 'master');
        if (branch !== 'master') {
            git(work, 'switch', 'hotfix/TASK-1');
            git(work, 'merge', '--ff-only', 'master');
        }
        fs.writeFileSync('CHANGELOG.md', stableText.replace('Published', 'Rewritten'));
        expect(hotfixStart()).toBe(true);
        expect(contents()).toContain('Rewritten correction.');
        expect(contents()).toContain('- Existing correction.');
        expect(contents()).toContain(`- ${'x'.repeat(150)}`);
        expect(fs.existsSync('.changelog/already-in-production.fixed.md')).toBe(false);
        expect(fs.existsSync('.changelog/long-note.changed.md')).toBe(false);
    });

    test('CRLF checkout collects committed fragments and supports subsequent hotfixes', () => {
        git(work, 'config', 'core.autocrlf', 'true');
        const checkout = stableText.replace(/\n/g, '\r\n');
        fs.writeFileSync('CHANGELOG.md', checkout);
        const committed = '- Pending correction.\r\n';
        fragment('committed.fixed.md', committed);
        commit('Pending correction');
        git(work, 'push', 'origin', 'HEAD:master');
        expect(hotfixStart()).toBe(true);
        expect(contents().endsWith(checkout.slice(checkout.indexOf('## ')))).toBe(true);
        expect(contents()).toContain('- Pending correction.');
        expect(fs.existsSync('.changelog/committed.fixed.md')).toBe(false);
        mergeHotfix();
        expect(hotfixDeploy()).toBe(true);
        git(work, 'switch', '-c', 'hotfix/TASK-2');
        fragment('TASK-2.fixed.md', '- TASK-2 Next correction.\r\n');
        expect(hotfixStart()).toBe(true);
        expect(contents()).toContain('## 🩹 [1.2.5]');
    });

    test('formatter failure restores original changelog and leaves fragments', () => {
        fragment('TASK-1.fixed.md');
        utils.execCommand.mockReturnValue(false);
        expect(hotfixStart()).toBe(false);
        expect(contents()).toBe(stableText);
        expect(fs.existsSync('.changelog/TASK-1.fixed.md')).toBe(true);
    });

    test('formatted changelog is still validated before fragment cleanup', () => {
        fragment('TASK-1.fixed.md');
        utils.execCommand.mockImplementation(() => {
            fs.writeFileSync('CHANGELOG.md', contents().replace('## 🚀 [1.2.3] - 2026-01-01', '## Invalid heading'));
            return true;
        });
        expect(hotfixStart()).toBe(false);
        expect(contents()).toBe(stableText);
        expect(fs.existsSync('.changelog/TASK-1.fixed.md')).toBe(true);
    });

    test('main/develop aliases and annotated stable tags work', () => {
        git(work, 'tag', '-d', 'v1.2.3');
        git(work, 'tag', '-a', 'v1.2.3', initial, '-m', 'Published baseline');
        git(work, 'push', '--force', 'origin', 'refs/tags/v1.2.3');
        git(work, 'branch', '-m', 'master', 'main');
        git(work, 'branch', '-m', 'dev', 'develop');
        git(work, 'push', 'origin', 'main', 'develop');
        git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');
        git(work, 'push', 'origin', '--delete', 'master', 'dev');
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(true);
        commit('Prepared MR');
        git(work, 'switch', 'main');
        git(work, 'merge', '--ff-only', 'hotfix/TASK-1');
        git(work, 'push', 'origin', 'main');
        expect(hotfixDeploy()).toBe(true);
        expect(hotfixClose()).toBe(true);
        expect(git(work, 'branch', '--show-current')).toBe('develop');
        expect(fs.existsSync('unfinished-feature')).toBe(true);
    });

    test('local-only and unreachable stable tags do not change the baseline', () => {
        git(work, 'tag', 'v8.0.0');
        git(work, 'switch', 'dev');
        git(work, 'tag', 'v9.0.0');
        git(work, 'push', 'origin', 'v9.0.0');
        git(work, 'switch', 'hotfix/TASK-1');
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(true);
        expect(contents()).toContain('[1.2.4]');
    });

    test('rejects start without entries or with a conflicting local tag', () => {
        expect(hotfixStart()).toBe(false);
        fragment('TASK-1.fixed.md');
        git(work, 'tag', 'hotfix/1.2.4');
        expect(hotfixStart()).toBe(false);
        expect(contents()).toBe(stableText);
    });

    test('reports independent hotfix preflight failures together', () => {
        fragment('TASK-1.added.md', '- Incompatible for a hotfix.\n');
        git(work, 'tag', 'hotfix/1.2.4');

        expect(withDryRun(true, () => hotfixStart())).toBe(false);
        const output = log.mock.calls.flat().join('\n');
        expect(output).toContain('Предпроверка не пройдена (');
        expect(output).toContain('tag-missing');
        expect(output).toContain('changelog-fragments');
        expect(output).toContain('Предпроверка не выполнена (');
        expect(contents()).toBe(stableText);
        expect(fs.existsSync('.changelog/TASK-1.added.md')).toBe(true);
    });

    test('stale hotfix must first incorporate updated production', () => {
        git(work, 'switch', 'master');
        fs.writeFileSync('other-hotfix', 'change');
        commit('Concurrent production change');
        git(work, 'push', 'origin', 'master');
        git(work, 'switch', 'hotfix/TASK-1');
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(false);
        expect(contents()).toBe(stableText);
    });

});
