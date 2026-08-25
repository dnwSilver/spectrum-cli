#!/usr/bin/env node
const { goToDevBranch, goToMainBranch, updateCurrentBranch } = require('./git');
const { changelogBuildRelease, changelogRemoveFragments } = require('./changelog');
const { getVersion, logSuccess, logError, execCommand, getCurrentBranch, getMainBranch, getMergeRequestUrl, getPackageManager } = require('./utils');
const { runCommand } = require('./command-executor');
const { compareVersions, upVersion, updateVersionFileExact } = require('./version');
const {
    requireGitRepo,
    requireCleanWorkingTree,
    requireCurrentBranchUpToDateWithRemote,
    requireMainAndDevBranches,
    requireOnDevBranch,
    requireOnMainBranch,
    requireReleaseBranchMissing,
    requireReleaseVersionAvailable,
    requireStablePackageVersion,
    requireLatestStableVersion,
    requireStableTagAtHead,
    requireFileExists,
    requireChangelogFormatted,
    requireChangelogFragments
} = require('./preflight');
const { CHANGELOG_FILE } = require('./changelog-config');

function getReleaseBranchName(version) {
    return `release/${version}`;
}

function releaseCreate(context) {
    const branchName = context.releaseBranch;
    if (!branchName) {
        logError('❌', 'Не удалось определить имя release-ветки.');
        return false;
    }

    if (!execCommand(`git switch -c ${branchName}`)) {
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

function resolveNextDevelopmentVersion(stableVersion, currentVersion) {
    const nextPatchVersion = upVersion(stableVersion, 'patch');
    if (!nextPatchVersion) return null;
    if (!currentVersion) return nextPatchVersion;
    return compareVersions(currentVersion, nextPatchVersion) > 0
        ? currentVersion
        : nextPatchVersion;
}

function runInstall(context = {}) {
    if (context.developmentVersionChanged === false) {
        return true;
    }
    const pm = getPackageManager() || 'npm';
    if (!execCommand(`${pm} install`)) {
        logError('❌', 'Не удалось выполнить %s install.', pm);
        return false;
    }
    logSuccess('📦', 'Lock-файл обновлен (%s install).', pm);
    return true;
}

function updateReleaseVersion(context) {
    return updateVersionFileExact(context.newVersion);
}

function releaseCommit() {
    const lockFiles = { npm: 'package-lock.json', yarn: 'yarn.lock', bun: 'bun.lockb' };
    const pm = getPackageManager();
    const filesToAdd = [CHANGELOG_FILE, '.changelog', 'package.json'];
    if (pm && lockFiles[pm]) {
        filesToAdd.push(lockFiles[pm]);
    }

    const addSuccess = execCommand(`git add --all -- ${filesToAdd.join(' ')}`);
    const commitSuccess = execCommand('git commit --message "📝 Обновить changelog и версию." --no-verify');

    if (addSuccess && commitSuccess) {
        logSuccess('📝', 'Коммит с обновленным changelog и версией создан.');
        return true;
    }
    return false;
}

function prepareNextDevelopmentVersion(context) {
    const currentVersion = getVersion();
    let nextDevelopmentVersion;
    try {
        nextDevelopmentVersion = resolveNextDevelopmentVersion(context.stableVersion, currentVersion);
    } catch (error) {
        logError('❌', 'Не удалось сравнить dev-версию с новой стабильной версией: %s', error.message);
        return false;
    }

    if (!nextDevelopmentVersion) {
        logError('❌', 'Не удалось вычислить следующую dev-версию.');
        return false;
    }

    context.nextDevelopmentVersion = nextDevelopmentVersion;
    context.developmentVersionChanged = currentVersion !== nextDevelopmentVersion;
    if (!context.developmentVersionChanged) {
        logSuccess('🔖', 'Dev-версия %s уже опережает стабильную линию.', currentVersion);
        return true;
    }
    return updateVersionFileExact(nextDevelopmentVersion);
}

function commitNextDevelopmentVersion(context) {
    if (!context.developmentVersionChanged) return true;

    const lockFiles = { npm: 'package-lock.json', yarn: 'yarn.lock', bun: 'bun.lockb' };
    const pm = getPackageManager();
    const filesToAdd = ['package.json'];
    if (pm && lockFiles[pm]) {
        filesToAdd.push(lockFiles[pm]);
    }

    if (!execCommand(`git add -- ${filesToAdd.join(' ')}`)) return false;
    if (!execCommand(`git commit --message "🔖 Открыть разработку версии ${context.nextDevelopmentVersion}." --no-verify`)) {
        return false;
    }
    logSuccess('📝', 'Dev переведен на версию %s.', context.nextDevelopmentVersion);
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
            { name: 'package-version', run: requireStablePackageVersion },
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
            { name: 'open-next-development-version', run: prepareNextDevelopmentVersion },
            { name: 'update-lock-file', run: runInstall },
            { name: 'commit-next-development-version', run: commitNextDevelopmentVersion },
            {
                name: 'push-dev',
                run: () => {
                    const currentBranch = getCurrentBranch();
                    if (!execCommand(`git push origin ${currentBranch}`)) {
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
            { name: 'package-version', run: requireStablePackageVersion },
            { name: 'on-dev-branch', run: requireOnDevBranch },
            { name: 'stable-version', run: requireLatestStableVersion },
            { name: 'changelog-exists', run: () => requireFileExists(CHANGELOG_FILE) },
            { name: 'changelog-prettier-check', run: requireChangelogFormatted },
            { name: 'changelog-fragments', run: requireChangelogFragments },
            {
                name: 'detect-bump-type',
                run: (ctx) => {
                    const resolved = resolveReleaseVersion(ctx.stableVersion, ctx.changelogFragments);
                    if (!resolved) {
                        return { ok: false, reason: 'Не удалось вычислить release-версию от последнего стабильного тега.' };
                    }

                    const nextDevelopmentVersion = upVersion(ctx.stableVersion, 'patch');
                    if (compareVersions(ctx.version, nextDevelopmentVersion) < 0) {
                        return {
                            ok: false,
                            reason: `Dev-версия ${ctx.version} устарела: после ${ctx.stableVersion} ожидается минимум ${nextDevelopmentVersion}.`
                        };
                    }
                    if (compareVersions(ctx.version, resolved.newVersion) > 0) {
                        return {
                            ok: false,
                            reason: `Вычисленная версия ${resolved.newVersion} ниже текущей dev-версии ${ctx.version}.`
                        };
                    }

                    const releaseBranch = getReleaseBranchName(resolved.newVersion);
                    const branchCheck = requireReleaseBranchMissing(releaseBranch);
                    if (!branchCheck.ok) return branchCheck;
                    const versionCheck = requireReleaseVersionAvailable(resolved.newVersion);
                    if (!versionCheck.ok) return versionCheck;
                    return { ok: true, data: { ...resolved, releaseBranch } };
                }
            }
        ],
        steps: [
            { name: 'set-release-version', run: updateReleaseVersion },
            { name: 'run-install', run: runInstall },
            { name: 'build-release-changelog', run: changelogBuildRelease },
            { name: 'remove-changelog-fragments', run: changelogRemoveFragments },
            { name: 'lint-changelog', run: releaseCheckChangelogLint },
            { name: 'create-release-branch', run: releaseCreate },
            { name: 'commit-release', run: releaseCommit },
            { name: 'push-release', run: releasePush }
        ]
    });
}

module.exports = {
    getReleaseBranchName,
    releaseCreate,
    releasePush,
    releaseClose,
    releaseStart,
    detectBumpType,
    resolveReleaseVersion,
    resolveNextDevelopmentVersion,
    prepareNextDevelopmentVersion,
    commitNextDevelopmentVersion
};
