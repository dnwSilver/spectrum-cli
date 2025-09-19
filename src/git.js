#!/usr/bin/env node
const { logSuccess, logError, execSilent, execCommand, getCurrentBranch, getMainBranch, getDevelopBranch, getVersion } = require('./utils');

function goToMainBranch() {
    const mainBranch = getMainBranch();
    if (execCommand(`git switch ${mainBranch}`, null, null)) {
        logSuccess('󱓏', `Swap to branch ${mainBranch}.`);
        return true;
    }
    return false;
}

function goToDevBranch() {
    const devBranch = getDevelopBranch();
    if (execCommand(`git switch ${devBranch}`, null, null)) {
        logSuccess('󱓏', `Swap to branch ${getCurrentBranch()}.`);
        return true;
    }
    return false;
}

function updateCurrentBranch() {
    const currentBranch = getCurrentBranch();
    const pullSuccess = execCommand(`git pull origin ${currentBranch}`, null, null);
    const fetchSuccess = execCommand(`git fetch --all --prune --jobs=10`, null, null);
    
    if (pullSuccess && fetchSuccess) {
        logSuccess('󱓍', `Pull and fetch from branch ${currentBranch}.`);
        return true;
    }
    return false;
}

function gitMergeOriginDev() {
    const devBranch = getDevelopBranch();
    const currentBranch = getCurrentBranch();
    
    goToDevBranch();
    updateCurrentBranch();
    
    if (execCommand(`git switch ${currentBranch}`, null, null)) {
        return execCommand(`git merge origin/${devBranch}`, null, null);
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
        if (!execCommand(command, null, null)) {
            success = false;
            break;
        }
    }
    
    if (success) {
        execCommand('rm .gitattributes', null, null);
        execCommand('git restore .gitattributes', null, null);
        logSuccess('󰴋', 'Reinstall git-lfs and clear files.');
    }
    
    return success;
}

function gitCreateTagAndPush() {
    goToMainBranch();
    updateCurrentBranch();
    
    const currentVersion = getVersion();
    if (!currentVersion) {
        logError('󰜣', 'Cannot get version from package.json');
        return false;
    }
    
    const existingTag = execSilent(`git tag -l "v${currentVersion}"`);
    
    if (existingTag) {
        logError('󰜣', `Tag v${currentVersion} already created.`);
        return false;
    }
    
    if (execCommand(`git tag v${currentVersion}`, null, null)) {
        logSuccess('󰜢', `Create tag v${currentVersion}.`);
        
        if (execCommand(`git push origin v${currentVersion}`, null, null)) {
            logSuccess('󱩺', `Push tag v${currentVersion}.`);
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
