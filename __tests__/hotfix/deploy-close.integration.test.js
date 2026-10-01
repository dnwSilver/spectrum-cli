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

describe('hotfix deploy-close with real Git origins', () => {
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
