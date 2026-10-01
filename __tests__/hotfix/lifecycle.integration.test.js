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

describe('hotfix lifecycle with real Git origins', () => {
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

    test('dry mode checks each hotfix phase without editing changelog, creating a tag or switching branches', () => {
        fragment('TASK-1.fixed.md');
        expect(withDryRun(true, () => hotfixStart())).toBe(true);
        expect(contents()).toBe(stableText);
        expect(fs.existsSync('.changelog/TASK-1.fixed.md')).toBe(true);

        expect(hotfixStart()).toBe(true);
        mergeHotfix();
        expect(withDryRun(true, () => hotfixDeploy())).toBe(true);
        expect(git(origin, 'tag', '-l', 'hotfix/1.2.4')).toBe('');

        expect(hotfixDeploy()).toBe(true);
        const devBefore = git(origin, 'rev-parse', 'refs/heads/dev');
        expect(withDryRun(true, () => hotfixClose())).toBe(true);
        expect(git(work, 'branch', '--show-current')).toBe('master');
        expect(git(origin, 'rev-parse', 'refs/heads/dev')).toBe(devBefore);
        const output = log.mock.calls.flat().join('\n');
        expect(output).toContain('Проверено');
        expect(output).toContain('production-history');
        expect(output).toContain('stable-tag-at-head');
    });

    test('silence hides successful hotfix preflights but keeps the dry result', () => {
        fragment('TASK-1.fixed.md');
        expect(withCommandOptions({ dry: true, silence: true }, () => hotfixStart())).toBe(true);
        const output = log.mock.calls.flat().join('\n');
        expect(output).not.toContain('Проверено (');
        expect(output).toContain('Все предпроверки пройдены');
        expect(contents()).toBe(stableText);
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

});
