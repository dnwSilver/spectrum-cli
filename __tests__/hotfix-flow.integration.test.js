const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

jest.mock('../src/utils', () => ({
    ...jest.requireActual('../src/utils'),
    execCommand: jest.fn(() => true),
}));
const utils = require('../src/utils');
const preflight = require('../src/preflight');
const { hotfixStart, hotfixDeploy, hotfixClose } = require('../src/hotfix');

function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

describe('isolated hotfix lifecycle with real Git origins', () => {
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
        fragment('inherited.added.md', '- Unrelated pending feature.\n');
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

    test('start prepares only local changelog; repeated start merges the same version and is a no-op without fragments', () => {
        fragment('TASK-1.fixed.md');
        fs.writeFileSync('implementation', 'local work');
        git(work, 'add', 'implementation');
        const index = git(work, 'diff', '--cached');
        expect(hotfixStart()).toBe(true);
        const first = contents();
        expect(first).toContain('## 🩹 [1.2.4]');
        expect(first).toContain('- TASK-1 Исправлена ошибка.');
        expect(first.endsWith(stableText.slice(stableText.indexOf('## ')))).toBe(true);
        expect(fs.existsSync('.changelog/TASK-1.fixed.md')).toBe(false);
        expect(fs.readFileSync('.changelog/inherited.added.md', 'utf8')).toBe('- Unrelated pending feature.\n');
        expect(git(work, 'diff', '--cached')).toBe(index);
        expect(git(work, 'rev-parse', 'HEAD')).toBe(initial);
        expect(git(origin, 'rev-parse', 'refs/heads/master')).toBe(initial);
        fragment('TASK-2.security.md', '- TASK-2 Закрыта уязвимость.\n');
        fragment('TASK-1-repeat.fixed.md');
        expect(hotfixStart()).toBe(true);
        expect(contents().match(/\[1\.2\.4\]/g)).toHaveLength(1);
        expect(contents().match(/TASK-1 Исправлена ошибка/g)).toHaveLength(1);
        expect(contents()).toContain('- TASK-2 Закрыта уязвимость.');
        expect(contents()).not.toContain('1.2.5');
        const second = contents();
        expect(hotfixStart()).toBe(true);
        expect(contents()).toBe(second);
        expect(fs.readFileSync('package.json', 'utf8')).toBe('{"version":"0.0.0"}\n');
    });

    test('full cycle tags only merged hotfix and reconciles into dev without leaking dev work', () => {
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(true);
        mergeHotfix();
        expect(fs.existsSync('unfinished-feature')).toBe(false);
        expect(hotfixDeploy()).toBe(true);
        const deployed = git(origin, 'rev-parse', 'refs/tags/hotfix/1.2.4');
        expect(deployed).toBe(git(origin, 'rev-parse', 'refs/heads/master'));
        expect(hotfixClose()).toBe(true);
        expect(git(work, 'branch', '--show-current')).toBe('dev');
        expect(fs.existsSync('unfinished-feature')).toBe(true);
        expect(fs.existsSync('.changelog/dev-feature.breaking.md')).toBe(true);
        expect(fs.existsSync('.changelog/TASK-1.fixed.md')).toBe(false);
        expect(contents().match(/\[1\.2\.4\]/g)).toHaveLength(1);
        expect(git(origin, 'rev-parse', 'refs/heads/master')).toBe(deployed);
        expect(git(work, 'rev-parse', 'HEAD')).toBe(git(origin, 'rev-parse', 'refs/heads/dev'));
    });

    test('another hotfix on merged but unpublished production reuses the pending patch', () => {
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(true);
        mergeHotfix();
        git(work, 'switch', '-c', 'hotfix/TASK-2');
        fragment('TASK-2.support.md', '- TASK-2 Исправлено обслуживание.\n');
        expect(hotfixStart()).toBe(true);
        expect(contents().match(/\[1\.2\.4\]/g)).toHaveLength(1);
        expect(contents()).toContain('TASK-1');
        expect(contents()).toContain('TASK-2');
        expect(contents()).not.toContain('1.2.5');
    });

    test('after publication, a new hotfix targets the next patch and keeps released notes intact', () => {
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(true);
        mergeHotfix();
        expect(hotfixDeploy()).toBe(true);
        const published = contents();
        git(work, 'switch', '-c', 'hotfix/TASK-2');
        fragment('TASK-2.fixed.md', '- TASK-2 Другое исправление.\n');
        expect(hotfixStart()).toBe(true);
        expect(contents()).toContain('## 🩹 [1.2.5]');
        expect(contents().endsWith(published.slice(published.indexOf('## ')))).toBe(true);
    });

    test.each(['master', 'main'])('prepares directly on %s, then deploys and closes after explicit commit and push', (branch) => {
        git(work, 'switch', 'master');
        if (branch === 'main') {
            git(work, 'branch', '-m', 'master', 'main');
            git(work, 'push', 'origin', 'main');
            git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');
            git(work, 'push', 'origin', '--delete', 'master');
        }
        fs.writeFileSync('implementation', 'hotfix committed locally');
        fragment('TASK-1.security.md');
        commit('Local correction');
        const head = git(work, 'rev-parse', 'HEAD');
        expect(hotfixStart()).toBe(true);
        expect(contents()).toContain('## 🩹 [1.2.4]');
        expect(git(work, 'branch', '--show-current')).toBe(branch);
        expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
        expect(git(origin, 'rev-parse', `refs/heads/${branch}`)).toBe(initial);
        const prepared = contents();
        expect(hotfixStart()).toBe(true);
        expect(contents()).toBe(prepared);
        commit('Prepared hotfix');
        git(work, 'push', 'origin', branch);
        expect(hotfixDeploy()).toBe(true);
        expect(hotfixClose()).toBe(true);
        expect(fs.readFileSync('implementation', 'utf8')).toBe('hotfix committed locally');
        expect(fs.existsSync('unfinished-feature')).toBe(true);
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
        ['TASK-1.unknown.md', '- Unknown.\n'],
        ['TASK-1.fixed.md', 'Invalid line.\n'],
        ['TASK-1.fixed.md', ''],
        ['TASK-1.fixed.md', '- ' + 'x'.repeat(120)],
    ])('rejects invalid or non-patch fragment %s', (name, content) => {
        fragment(name, content);
        expect(hotfixStart()).toBe(false);
        expect(contents()).toBe(stableText);
        expect(fs.readFileSync(`.changelog/${name}`, 'utf8')).toBe(content);
    });

    test('inherited fragments and published history cannot be changed', () => {
        fragment('inherited.added.md', '- Modified inherited fragment.\n');
        expect(hotfixStart()).toBe(false);
        fragment('inherited.added.md', '- Unrelated pending feature.\n');
        fragment('TASK-1.fixed.md');
        fs.writeFileSync('CHANGELOG.md', stableText.replace('Published', 'Rewritten'));
        expect(hotfixStart()).toBe(false);
        expect(fs.existsSync('.changelog/TASK-1.fixed.md')).toBe(true);
    });

    test('CRLF checkout preserves inherited fragments and supports subsequent hotfixes', () => {
        git(work, 'config', 'core.autocrlf', 'true');
        const checkout = stableText.replace(/\n/g, '\r\n');
        fs.writeFileSync('CHANGELOG.md', checkout);
        const inherited = '- Unrelated pending feature.\r\n';
        fragment('inherited.added.md', inherited);
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(true);
        expect(contents().endsWith(checkout.slice(checkout.indexOf('## ')))).toBe(true);
        expect(fs.readFileSync('.changelog/inherited.added.md', 'utf8')).toBe(inherited);
        mergeHotfix();
        expect(hotfixDeploy()).toBe(true);
        git(work, 'switch', '-c', 'hotfix/TASK-2');
        fragment('TASK-2.fixed.md', '- TASK-2 Next correction.\r\n');
        expect(hotfixStart()).toBe(true);
        expect(contents()).toContain('## 🩹 [1.2.5]');
        fragment('inherited.added.md', '- Actual edit.\r\n');
        expect(hotfixStart()).toBe(false);
    });

    test('formatter failure restores original changelog and leaves fragments', () => {
        fragment('TASK-1.fixed.md');
        utils.execCommand.mockReturnValue(false);
        expect(hotfixStart()).toBe(false);
        expect(contents()).toBe(stableText);
        expect(fs.existsSync('.changelog/TASK-1.fixed.md')).toBe(true);
    });

    test('formatter cannot rewrite published history before fragment cleanup', () => {
        fragment('TASK-1.fixed.md');
        utils.execCommand.mockImplementation(() => {
            fs.writeFileSync('CHANGELOG.md', contents().replace('Published correction.', 'Changed history.'));
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

    test('deploy rejects missing preparation, wrong branch, local-only commits, and dirty files', () => {
        expect(hotfixDeploy()).toBe(false);
        git(work, 'switch', 'master');
        expect(hotfixDeploy()).toBe(false);
        git(work, 'switch', 'hotfix/TASK-1');
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(true);
        mergeHotfix();
        fs.writeFileSync('dirty', 'local');
        expect(hotfixDeploy()).toBe(false);
        commit('Local-only commit');
        expect(hotfixDeploy()).toBe(false);
        expect(git(origin, 'tag', '--list', 'hotfix/1.2.4')).toBe('');
    });

    test('failed tag push can be retried without moving or recreating the tag', () => {
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(true);
        mergeHotfix();
        const hook = path.join(origin, 'hooks', 'pre-receive');
        fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        expect(hotfixDeploy()).toBe(false);
        const tag = git(work, 'rev-parse', 'hotfix/1.2.4');
        fs.unlinkSync(hook);
        expect(hotfixDeploy()).toBe(true);
        expect(git(origin, 'rev-parse', 'hotfix/1.2.4')).toBe(tag);
        expect(hotfixDeploy()).toBe(false);
    });

    test('close refuses unpublished hotfix and local dev commits', () => {
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(true);
        mergeHotfix();
        expect(hotfixClose()).toBe(false);
        expect(hotfixDeploy()).toBe(true);
        const devBefore = git(origin, 'rev-parse', 'refs/heads/dev');
        git(work, 'switch', 'dev');
        fs.writeFileSync('local-only', 'must not auto-push');
        commit('Local dev commit');
        git(work, 'switch', 'master');
        expect(hotfixClose()).toBe(false);
        expect(git(origin, 'rev-parse', 'refs/heads/dev')).toBe(devBefore);
    });

    test.each(['dev', 'feature/TASK-9', 'detached'])('every hotfix command rejects %s before reaching origin', (branch) => {
        if (branch === 'detached') git(work, 'switch', '--detach');
        else if (branch === 'dev') git(work, 'switch', 'dev');
        else git(work, 'switch', '-c', branch);
        git(work, 'remote', 'set-url', 'origin', path.join(temp, 'unavailable'));
        for (const command of [hotfixStart, hotfixDeploy, hotfixClose]) {
            log.mockClear();
            expect(command()).toBe(false);
            expect(log.mock.calls.flat().join(' ')).toContain('только на hotfix/*, main или master');
        }
    });

    test('a release tag is a hotfix baseline, but cannot close a hotfix as a hotfix tag', () => {
        git(work, 'tag', 'release/1.2.3', initial);
        git(work, 'push', 'origin', 'refs/tags/release/1.2.3');
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(true);
        mergeHotfix();
        git(work, 'tag', 'release/1.2.4');
        git(work, 'push', 'origin', 'refs/tags/release/1.2.4');
        expect(hotfixClose()).toBe(false);
        expect(hotfixDeploy()).toBe(false);
    });

    test.each(['v1.2.4', 'release/1.2.4'])('local alias %s blocks hotfix tag creation', (tag) => {
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(true);
        mergeHotfix();
        git(work, 'tag', tag);
        expect(hotfixDeploy()).toBe(false);
        expect(git(origin, 'tag', '--list', 'hotfix/1.2.4')).toBe('');
    });

    test('close leaves conflicts for resolution and never pushes a conflicted merge', () => {
        git(work, 'switch', 'dev');
        fs.writeFileSync('conflict', 'dev');
        commit('Dev change');
        git(work, 'push', 'origin', 'dev');
        const devBefore = git(origin, 'rev-parse', 'refs/heads/dev');
        git(work, 'switch', 'hotfix/TASK-1');
        fs.writeFileSync('conflict', 'hotfix');
        fragment('TASK-1.fixed.md');
        expect(hotfixStart()).toBe(true);
        mergeHotfix();
        expect(hotfixDeploy()).toBe(true);
        expect(hotfixClose()).toBe(false);
        expect(git(work, 'ls-files', '--unmerged')).not.toBe('');
        expect(git(origin, 'rev-parse', 'refs/heads/dev')).toBe(devBefore);
    });
});
