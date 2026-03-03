#!/usr/bin/env node
const { logSuccess, logError, execSilent, execCommand, getCurrentBranch, getMainBranch, getDevelopBranch, getVersion } = require('./utils');

function goToMainBranch() {
    const mainBranch = getMainBranch();
    if (execCommand(`git switch ${mainBranch}`)) {
        logSuccess('🌿', 'Swap to branch %s.', mainBranch);
        return true;
    }
    return false;
}

function goToDevBranch() {
    const devBranch = getDevelopBranch();
    if (execCommand(`git switch ${devBranch}`)) {
        logSuccess('🌿', 'Swap to branch %s.', getCurrentBranch());
        return true;
    }
    return false;
}

function updateCurrentBranch() {
    const currentBranch = getCurrentBranch();
    const pullSuccess = execCommand(`git pull origin ${currentBranch}`);
    const fetchSuccess = execCommand(`git fetch --all --prune --jobs=10`);
    
    if (pullSuccess && fetchSuccess) {
        logSuccess('🔄', 'Pull and fetch from branch %s.', currentBranch);
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
        logSuccess('📦', 'Reinstall git-lfs and clear files.');
    }
    
    return success;
}

function gitCreateTagAndPush() {
    goToMainBranch();
    updateCurrentBranch();
    
    const currentVersion = getVersion();
    if (!currentVersion) {
        logError('❌', 'Cannot get version from package.json');
        return false;
    }
    
    const existingTag = execSilent(`git tag -l "v${currentVersion}"`);
    
    if (existingTag) {
        logError('❌', 'Tag v%s already created.', currentVersion);
        return false;
    }
    
    if (execCommand(`git tag v${currentVersion}`)) {
        logSuccess('🔖', 'Create tag v%s.', currentVersion);
        
        if (execCommand(`git push origin v${currentVersion}`)) {
            logSuccess('🚀', 'Push tag v%s.', currentVersion);
            return true;
        }
    }
    
    return false;
}


module.exports = {
    goToMainBranch,
    goToDevBranch,
    updateCurrentBranch,
    gitMergeOriginDev,
    gitLfsReset,
    gitCreateTagAndPush
};
