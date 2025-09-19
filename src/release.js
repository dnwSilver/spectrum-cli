#!/usr/bin/env node
const { goToDevBranch, goToMainBranch, updateCurrentBranch } = require('./git');
const { changelogChangeHeader, changelogRemoveEmptyChapters, changelogAddUnreleasedBlock, changelogCommit } = require('./changelog');
const { getVersion, logSuccess, logError, execCommand, getCurrentBranch, getMainBranch, colors } = require('./utils');

function releaseCreate() {
    goToDevBranch();
    updateCurrentBranch();
    
    const currentVersion = getVersion();
    if (!currentVersion) {
        logError('󰜣', 'Cannot get version from package.json');
        return false;
    }
    
    if (execCommand(`git switch -c release/${currentVersion}`, null, null)) {
        logSuccess('󱓊', `Create new release branch ${getCurrentBranch()}.`);
        return true;
    }
    
    return false;
}

function releasePush() {
    const currentBranch = getCurrentBranch();
    
    if (execCommand(`git push origin ${currentBranch}`, null, null)) {
        logSuccess('󱓎', `Push release branch ${currentBranch}.`);
        console.log(` ${colors.yellow} ${colors.reset}Go to https://gitlab.spectrumdata.tech/ and merge branch manually.`);
        goToMainBranch();
        return true;
    }
    
    return false;
}

function releaseClose() {
    const mainBranch = getMainBranch();
    
    goToMainBranch();
    updateCurrentBranch();
    
    goToDevBranch();
    updateCurrentBranch();
    
    if (execCommand(`git merge ${mainBranch}`, null, null)) {
        logSuccess('󰘬', `Merge branch ${getCurrentBranch()} with ${mainBranch}.`);
        
        if (execCommand(`git push origin ${getCurrentBranch()} -o ci.skip`, null, null)) {
            logSuccess('󱓎', `Push branch ${getCurrentBranch()}.`);
            return true;
        }
    }
    
    return false;
}

function releaseStart() {
    const steps = [
        { name: 'Create release branch', fn: releaseCreate },
        { name: 'Change header', fn: changelogChangeHeader },
        { name: 'Remove empty chapters', fn: changelogRemoveEmptyChapters },
        { name: 'Add unreleased block', fn: changelogAddUnreleasedBlock },
        { name: 'Commit changelog', fn: changelogCommit },
        { name: 'Push release', fn: releasePush }
    ];
    
    for (const step of steps) {
        if (!step.fn()) {
            logError('✖', `Failed at step: ${step.name}`);
            return false;
        }
    }
    
    logSuccess('🚀', 'Release started successfully!');
    return true;
}


module.exports = {
    releaseCreate,
    releasePush,
    releaseClose,
    releaseStart
};
