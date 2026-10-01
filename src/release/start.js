const { changelogBuildRelease, changelogRemoveFragments } = require('../changelog');
const { requireReleaseState, requireReleaseFragments, appendOpenRelease } = require('../changelog/open-release');
const { runCommand } = require('../cli/command-executor');
const { requireGitRepo, requireCleanWorkingTree, requireCurrentBranchUpToDateWithRemote, requireMainAndDevBranches, requireOnDevBranch, requireDevContainsRemoteMain, requireReleaseVersionAvailable, requireLatestStableVersion, requireFileExists, requireChangelogFormatted } = require('../preflight');
const { CHANGELOG_FILE } = require('../changelog/config');
const { detectBumpType, resolveReleaseVersion } = require('./version');
const { releaseFormatChangelog, releaseCheckChangelogLint, releaseCommit, releasePush } = require('./steps');
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
            { name: 'release-state', requires: ['mainBranch', 'stableVersion'], run: requireReleaseState },
            { name: 'changelog-prettier-check', run: requireChangelogFormatted },
            { name: 'changelog-fragments', run: requireReleaseFragments },
            {
                name: 'detect-bump-type',
                requires: ['changelogFragments', 'stableVersion'],
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

module.exports = { releaseStart };
