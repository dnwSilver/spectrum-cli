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

function formatLogMessage(template, args, color) {
    if (!args || args.length === 0) {
        return template;
    }

    let argIndex = 0;
    return template.replace(/%s/g, () => {
        if (argIndex >= args.length) {
            return '%s';
        }

        const value = args[argIndex];
        argIndex += 1;
        return `${color}${String(value)}${colors.reset}`;
    });
}

function logSuccess(emoji, message, ...args) {
    log(emoji, formatLogMessage(message, args, colors.green));
}

function logError(emoji, message, ...args) {
    log(emoji, formatLogMessage(message, args, colors.red));
}

function execSilent(command) {
    try {
        return execSync(command, { stdio: 'pipe', encoding: 'utf8' }).trim();
    } catch (error) {
        return null;
    }
}

function execCommand(command) {
    try {
        execSync(command, { stdio: 'pipe' });
        return true;
    } catch (error) {
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
