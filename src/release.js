#!/usr/bin/env node
const { goToDevBranch, goToMainBranch, updateCurrentBranch } = require('./git');
const { changelogChangeHeader, changelogRemoveEmptyChapters, changelogAddUnreleasedBlock, changelogCommit } = require('./changelog');
const path = require('path');
const { getVersion, logSuccess, logError, execCommand, getCurrentBranch, getMainBranch, getMergeRequestUrl } = require('./utils');
const { runCommand } = require('./command-executor');
const {
    requireGitRepo,
    requireCleanWorkingTree,
    requireCurrentBranchUpToDateWithRemote,
    requireMainAndDevBranches,
    requireOnDevBranch,
    requireOnMainBranch,
    requireReleaseBranchMissing,
    requirePackageVersion,
    requireFileExists,
    requireChangelogFormatted
} = require('./preflight');

function releaseCreate() {
    if (!goToDevBranch()) return false;
    if (!updateCurrentBranch()) return false;

    const currentVersion = getVersion();
    if (!currentVersion) {
        logError('❌', 'Не удалось получить версию из package.json');
        return false;
    }

    if (!execCommand(`git switch -c release/${currentVersion}`)) {
        return false;
    }

    logSuccess('🌱', 'Создана новая release-ветка %s.', getCurrentBranch());
    return true;
}

function releasePush() {
    const currentBranch = getCurrentBranch();
    if (!execCommand(`git push origin ${currentBranch}`)) {
        return false;
    }

    logSuccess('📤', 'Release-ветка %s отправлена.', currentBranch);
    const mrUrl = getMergeRequestUrl(currentBranch, getMainBranch());
    if (mrUrl) {
        logSuccess('🌐', 'Создать Merge Request: %s', mrUrl);
    }
    return goToMainBranch();
}

function releaseCheckChangelogLint() {
    const result = requireChangelogFormatted();
    if (!result.ok) {
        logError('❌', result.reason || 'Файл CHANGELOG.md не прошел линтинг.');
        return false;
    }
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
            { name: 'main-and-dev-branches', run: requireMainAndDevBranches }
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
            {
                name: 'push-dev',
                run: () => {
                    const currentBranch = getCurrentBranch();
                    if (!execCommand(`git push origin ${currentBranch} -o ci.skip`)) {
                        return false;
                    }
                    logSuccess('📤', 'Ветка %s отправлена.', currentBranch);
                    return true;
                }
            }
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
            { name: 'package-version', run: requirePackageVersion },
            { name: 'on-dev-branch', run: requireOnDevBranch },
            { name: 'changelog-exists', run: () => requireFileExists('CHANGELOG.md') },
            { name: 'unreleased-template-exists', run: () => requireFileExists(path.join(__dirname, 'UNRELEASED.md')) },
            { name: 'changelog-prettier-check', run: requireChangelogFormatted },
            { name: 'release-branch-missing', run: (ctx) => requireReleaseBranchMissing(`release/${ctx.version}`) }
        ],
        steps: [
            { name: 'change-header', run: changelogChangeHeader },
            { name: 'remove-empty-chapters', run: changelogRemoveEmptyChapters },
            { name: 'add-unreleased-block', run: changelogAddUnreleasedBlock },
            { name: 'lint-changelog', run: releaseCheckChangelogLint },
            { name: 'create-release-branch', run: releaseCreate },
            { name: 'commit-changelog', run: changelogCommit },
            { name: 'push-release', run: releasePush }
        ]
    });
}

module.exports = {
    releaseCreate,
    releasePush,
    releaseClose,
    releaseStart
};
