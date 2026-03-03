#!/usr/bin/env node
const { logSuccess, execCommand, getCurrentBranch, getMainBranch, getDevelopBranch } = require('./utils');
const { runCommand } = require('./command-executor');
const {
    requireGitRepo,
    requireCleanWorkingTree,
    requireOnMainBranch,
    requireCurrentBranchUpToDateWithRemote,
    requirePackageVersion,
    requireTagMissing
} = require('./preflight');

function goToMainBranch() {
    const mainBranch = getMainBranch();
    if (execCommand(`git switch ${mainBranch}`)) {
        logSuccess('🌿', 'Переключение на ветку %s выполнено.', mainBranch);
        return true;
    }
    return false;
}

function goToDevBranch() {
    const devBranch = getDevelopBranch();
    if (execCommand(`git switch ${devBranch}`)) {
        logSuccess('🌿', 'Переключение на ветку %s выполнено.', getCurrentBranch());
        return true;
    }
    return false;
}

function updateCurrentBranch() {
    const currentBranch = getCurrentBranch();
    const pullSuccess = execCommand(`git pull origin ${currentBranch}`);
    const fetchSuccess = execCommand(`git fetch --all --prune --jobs=10`);
    
    if (pullSuccess && fetchSuccess) {
        logSuccess('🔄', 'Для ветки %s выполнены pull и fetch.', currentBranch);
        return true;
    }
    return false;
}

function gitMergeOriginDev() {
    const devBranch = getDevelopBranch();
    const currentBranch = getCurrentBranch();
    
    goToDevBranch();
    updateCurrentBranch();
    
    if (execCommand(`git switch ${currentBranch}`)) {
        return execCommand(`git merge origin/${devBranch}`);
    }
    return false;
}

function gitLfsReset() {
    const commands = [
        'git lfs uninstall',
        'git reset --hard',
        'git lfs install',
        'git lfs pull'
    ];
    
    let success = true;
    for (const command of commands) {
        if (!execCommand(command)) {
            success = false;
            break;
        }
    }
    
    if (success) {
        execCommand('rm .gitattributes');
        execCommand('git restore .gitattributes');
        logSuccess('📦', 'git-lfs переустановлен, файлы очищены.');
    }
    
    return success;
}

function gitCreateTagAndPush() {
    return runCommand({
        name: 'release deploy',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'clean-working-tree', run: requireCleanWorkingTree },
            { name: 'on-main-branch', run: requireOnMainBranch },
            { name: 'branch-up-to-date', run: requireCurrentBranchUpToDateWithRemote },
            { name: 'package-version', run: requirePackageVersion },
            {
                name: 'tag-missing',
                run: (ctx) => requireTagMissing(`v${ctx.version}`)
            }
        ],
        steps: [
            {
                name: 'update-main-branch',
                run: () => updateCurrentBranch()
            },
            {
                name: 'create-tag',
                run: (ctx) => {
                    if (!execCommand(`git tag v${ctx.version}`)) return false;
                    logSuccess('🔖', 'Создан тег v%s.', ctx.version);
                    return true;
                }
            },
            {
                name: 'push-tag',
                run: (ctx) => {
                    if (!execCommand(`git push origin v${ctx.version}`)) return false;
                    logSuccess('🚀', 'Тег v%s отправлен.', ctx.version);
                    return true;
                }
            }
        ]
    });
}


module.exports = {
    goToMainBranch,
    goToDevBranch,
    updateCurrentBranch,
    gitMergeOriginDev,
    gitLfsReset,
    gitCreateTagAndPush
};
