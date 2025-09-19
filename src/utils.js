#!/usr/bin/env node
const { execSync, exec } = require('child_process');
const fs = require('fs');

const colors = {
    red: '\x1b[91m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[94m',
    reset: '\x1b[0m'
};

function log(emoji, message, color = colors.green) {
    console.log(` ${emoji} ${message}`);
}

function logSuccess(emoji, message) {
    log(emoji, `${colors.green}${message}${colors.reset}`);
}

function logError(emoji, message) {
    log(emoji, `${colors.red}${message}${colors.reset}`);
}

function execSilent(command) {
    try {
        return execSync(command, { stdio: 'pipe', encoding: 'utf8' }).trim();
    } catch (error) {
        return null;
    }
}

function execCommand(command, successMessage, errorMessage) {
    try {
        execSync(command, { stdio: 'pipe' });
        return true;
    } catch (error) {
        if (errorMessage) {
            console.error(errorMessage);
        }
        return false;
    }
}

function getCurrentBranch() {
    return execSilent('git branch --show-current');
}

function getMainBranch() {
    const branches = execSilent('git branch -r');
    if (branches && branches.includes('origin/master')) {
        return 'master';
    }
    return 'main';
}

function getDevelopBranch() {
    const branches = execSilent('git branch -r');
    if (branches && branches.includes('origin/develop')) {
        return 'develop';
    }
    return 'dev';
}

function getPackageManager() {
    if (fs.existsSync('package-lock.json')) return 'npm';
    if (fs.existsSync('yarn.lock')) return 'yarn';
    if (fs.existsSync('bun.lockb')) return 'bun';
    return null;
}

function getVersion() {
    try {
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        return packageJson.version;
    } catch (error) {
        return null;
    }
}

module.exports = {
    colors,
    log,
    logSuccess,
    logError,
    execSilent,
    execCommand,
    getCurrentBranch,
    getMainBranch,
    getDevelopBranch,
    getPackageManager,
    getVersion
};
