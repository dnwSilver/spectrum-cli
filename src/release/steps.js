const { logSuccess, logError, execCommand, execSilent, getCurrentBranch, getMainBranch } = require('../common/utils');
const { requireChangelogFormatted, getPrettierRunner } = require('../preflight');
const { CHANGELOG_FILE, CHANGELOG_DIR } = require('../changelog/config');
function releaseFormatChangelog() {
    const runner = getPrettierRunner();
    if (!runner) {
        logError('❌', 'Prettier недоступен.');
        return false;
    }
    if (!execCommand(`${runner} --write ${CHANGELOG_FILE}`)) {
        logError('❌', 'Не удалось отформатировать %s с помощью Prettier.', CHANGELOG_FILE);
        return false;
    }
    logSuccess('🎨', 'Файл %s отформатирован.', CHANGELOG_FILE);
    return true;
}

function releaseCheckChangelogLint() {
    const result = requireChangelogFormatted();
    if (!result.ok) {
        logError('❌', result.reason || 'Файл CHANGELOG.md не прошел линтинг.');
        return false;
    }
    return true;
}

function releaseCommit(context) {
    const paths = context.changelogFragments?.length ? `${CHANGELOG_FILE} ${CHANGELOG_DIR}` : CHANGELOG_FILE;
    if (!execCommand(`git add --all -- ${paths}`)) return false;
    const staged = execSilent('git diff --cached --name-only');
    if (staged === null) return false;
    if (!staged.trim()) {
        logSuccess('📋', 'Новых changelog-записей нет; пустой коммит не создаётся.');
        return true;
    }
    if (!execCommand(`git commit --message "📝 Подготовить релиз ${context.newVersion}." --no-verify`)) return false;

    logSuccess('📝', 'Коммит со схлопнутыми changelog fragments создан.');
    return true;
}

function getReleasePushCommand(context) {
    const devBranch = context && context.devBranch;
    const targetBranch = (context && context.mainBranch) || getMainBranch();
    if (!devBranch || !targetBranch) return null;

    return `git push --atomic origin ${devBranch}:${devBranch} ${devBranch}:${targetBranch}`;
}

function releasePush(context) {
    const command = getReleasePushCommand(context);
    if (!command) {
        logError('❌', 'Не удалось сформировать команду публикации релиза.');
        return false;
    }

    if (!execCommand(command)) {
        logError(
            '❌',
            'Релиз не отправлен в dev и main/master. Убедитесь, что dev содержит актуальный main/master и прямой push разрешен. Повторите: %s',
            command
        );
        return false;
    }

    const devBranch = context.devBranch;
    const targetBranch = context.mainBranch || getMainBranch();
    logSuccess('📤', 'Релиз атомарно отправлен в origin/%s и origin/%s.', devBranch, targetBranch);
    return true;
}

function pushDev(context) {
    const devBranch = context.devBranch || getCurrentBranch();
    const command = `git push origin ${devBranch}`;
    if (!execCommand(command)) {
        logError('❌', 'Dev-ветка не отправлена. Повторите: %s', command);
        return false;
    }
    logSuccess('📤', 'Ветка %s отправлена.', devBranch);
    return true;
}

module.exports = { releaseFormatChangelog, releaseCheckChangelogLint, releaseCommit, getReleasePushCommand, releasePush, pushDev };
