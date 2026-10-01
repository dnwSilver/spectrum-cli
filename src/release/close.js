const { goToDevBranch, goToMainBranch, updateCurrentBranch } = require('../git');
const { logSuccess, execCommand, getCurrentBranch, getMainBranch } = require('../common/utils');
const { runCommand } = require('../cli/command-executor');
const { requireGitRepo, requireCleanWorkingTree, requireCurrentBranchUpToDateWithRemote, requireOnMainBranch, requireMainAndDevBranches, requireChangelogReleaseVersion, requireStableTagAtHead } = require('../preflight');
const { pushDev } = require('./steps');
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
            { name: 'stable-tag-at-head', requires: ['version'], run: (ctx) => requireStableTagAtHead(ctx.version) }
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

module.exports = { releaseClose };
