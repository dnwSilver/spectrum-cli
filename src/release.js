#!/usr/bin/env node
const { goToDevBranch, goToMainBranch, updateCurrentBranch } = require('./git');
const { changelogBuildRelease, changelogRemoveFragments } = require('./changelog');
const { logSuccess, logError, execCommand, execSilent, getCurrentBranch, getMainBranch } = require('./utils');
const { requireReleaseState, requireReleaseFragments, appendOpenRelease } = require('./open-release');
const { runCommand } = require('./command-executor');
const { upVersion } = require('./version');
const {
    requireGitRepo,
    requireCleanWorkingTree,
    requireCurrentBranchUpToDateWithRemote,
    requireMainAndDevBranches,
    requireOnDevBranch,
    requireDevContainsRemoteMain,
    requireOnMainBranch,
    requireReleaseVersionAvailable,
    requireChangelogReleaseVersion,
    requireLatestStableVersion,
    requireStableTagAtHead,
    requireFileExists,
    requireChangelogFormatted,
    getPrettierRunner
} = require('./preflight');
const { CHANGELOG_FILE, CHANGELOG_DIR } = require('./changelog-config');

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

function detectBumpType(fragments) {
    const bumpTypes = new Set((fragments || []).map((fragment) => fragment.bump));
    if (bumpTypes.has('major')) {
        return 'major';
    }
    if (bumpTypes.has('minor')) {
        return 'minor';
    }
    return 'patch';
}

function resolveReleaseVersion(stableVersion, fragments) {
    const bumpType = detectBumpType(fragments);
    const newVersion = upVersion(stableVersion, bumpType);
    if (!newVersion) return null;
    return { bumpType, newVersion };
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

function releaseClose() {
    return runCommand({
        name: 'release close',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'clean-working-tree', run: requireCleanWorkingTree },
            { name: 'branch-up-to-date', run: requireCurrentBranchUpToDateWithRemote },
            { name: 'on-main-branch', run: requireOnMainBranch },
            { name: 'main-and-dev-branches', run: requireMainAndDevBranches },
            { name: 'changelog-release-version', run: requireChangelogReleaseVersion },
            { name: 'stable-tag-at-head', run: (ctx) => requireStableTagAtHead(ctx.version) }
        ],
        steps: [
            { name: 'switch-main', run: () => goToMainBranch() },
            { name: 'update-main', run: () => updateCurrentBranch() },
            { name: 'switch-dev', run: () => goToDevBranch() },
            { name: 'update-dev', run: () => updateCurrentBranch() },
            {
                name: 'merge-main-into-dev',
                run: () => {
                    const mainBranch = getMainBranch();
                    if (!execCommand(`git merge ${mainBranch}`)) {
                        return false;
                    }
                    logSuccess('🔀', 'Ветка %s смержена с %s.', getCurrentBranch(), mainBranch);
                    return true;
                }
            },
            { name: 'push-dev', run: pushDev }
        ]
    });
}

function releaseStart() {
    return runCommand({
        name: 'release start',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'clean-working-tree', run: requireCleanWorkingTree },
            { name: 'branch-up-to-date', run: requireCurrentBranchUpToDateWithRemote },
            { name: 'main-and-dev-branches', run: requireMainAndDevBranches },
            { name: 'on-dev-branch', run: requireOnDevBranch },
            { name: 'dev-contains-main', run: requireDevContainsRemoteMain },
            { name: 'stable-version', run: requireLatestStableVersion },
            { name: 'changelog-exists', run: () => requireFileExists(CHANGELOG_FILE) },
            { name: 'release-state', run: requireReleaseState },
            { name: 'changelog-prettier-check', run: requireChangelogFormatted },
            { name: 'changelog-fragments', run: requireReleaseFragments },
            {
                name: 'detect-bump-type',
                run: (ctx) => {
                    const resolved = ctx.openReleaseVersion
                        ? { bumpType: detectBumpType(ctx.changelogFragments), newVersion: ctx.openReleaseVersion }
                        : resolveReleaseVersion(ctx.stableVersion, ctx.changelogFragments);
                    if (!resolved) {
                        return { ok: false, reason: 'Не удалось вычислить release-версию от последнего стабильного тега.' };
                    }

                    const versionCheck = requireReleaseVersionAvailable(resolved.newVersion);
                    if (!versionCheck.ok) return versionCheck;
                    return { ok: true, data: resolved };
                }
            }
        ],
        steps: [
            { name: 'build-release-changelog', run: (ctx) => ctx.openReleaseVersion ? appendOpenRelease(ctx) : changelogBuildRelease(ctx) },
            { name: 'format-changelog', run: releaseFormatChangelog },
            { name: 'lint-changelog', run: releaseCheckChangelogLint },
            { name: 'remove-changelog-fragments', run: (ctx) => !ctx.changelogFragments.length || changelogRemoveFragments(ctx) },
            { name: 'commit-release', run: releaseCommit },
            { name: 'push-dev-and-main', run: releasePush }
        ]
    });
}

module.exports = {
    getReleasePushCommand,
    releaseCommit,
    releasePush,
    releaseClose,
    releaseStart,
    detectBumpType,
    resolveReleaseVersion,
    pushDev
};
