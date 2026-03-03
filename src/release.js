#!/usr/bin/env node
const { goToDevBranch, goToMainBranch, updateCurrentBranch } = require('./git');
const { changelogChangeHeader, changelogRemoveEmptyChapters, changelogAddUnreleasedBlock, changelogCommit } = require('./changelog');
const { getVersion, logSuccess, logError, execCommand, getCurrentBranch, getMainBranch, getMergeRequestUrl } = require('./utils');
const { runCommand } = require('./command-executor');
const {
    requireGitRepo,
    requireCleanWorkingTree,
    requireMainAndDevBranches,
    requirePackageVersion,
    requireFileExists,
    requireChangelogFormatted
} = require('./preflight');

function releaseCreate() {
    if (!goToDevBranch()) return false;
    if (!updateCurrentBranch()) return false;

    const currentVersion = getVersion();
    if (!currentVersion) {
        logError('❌', 'Cannot get version from package.json');
        return false;
    }

    if (!execCommand(`git switch -c release/${currentVersion}`)) {
        return false;
    }

    logSuccess('🌱', 'Create new release branch %s.', getCurrentBranch());
    return true;
}

function releasePush() {
    const currentBranch = getCurrentBranch();
    if (!execCommand(`git push origin ${currentBranch}`)) {
        return false;
    }

    logSuccess('📤', 'Push release branch %s.', currentBranch);
    const mrUrl = getMergeRequestUrl(currentBranch, getMainBranch());
    if (mrUrl) {
        logSuccess('🌐', 'Create Merge Request: %s', mrUrl);
    }
    return goToMainBranch();
}

function releaseClose() {
    return runCommand({
        name: 'release close',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'clean-working-tree', run: requireCleanWorkingTree },
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
                    logSuccess('🔀', 'Merge branch %s with %s.', getCurrentBranch(), mainBranch);
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
                    logSuccess('📤', 'Push branch %s.', currentBranch);
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
            { name: 'main-and-dev-branches', run: requireMainAndDevBranches },
            { name: 'package-version', run: requirePackageVersion },
            { name: 'changelog-exists', run: () => requireFileExists('CHANGELOG.md') },
            { name: 'changelog-prettier-check', run: requireChangelogFormatted }
        ],
        steps: [
            { name: 'create-release-branch', run: releaseCreate },
            { name: 'change-header', run: changelogChangeHeader },
            { name: 'remove-empty-chapters', run: changelogRemoveEmptyChapters },
            { name: 'add-unreleased-block', run: changelogAddUnreleasedBlock },
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
