#!/usr/bin/env node
const fs = require('fs');
const { logSuccess, logError } = require('./utils');
const { runCommand } = require('./command-executor');
const { requireGitRepo, requireCleanWorkingTree, requireFileExists, requirePackageVersion } = require('./preflight');

function upVersion(oldVersion, upType) {
    const [major, minor, patch] = oldVersion.split('.').map(Number);
    
    switch (upType) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
        default:
            return `${major}.${minor}.${patch + 1}`;
    }
}

function updateVersionFile(versionType) {
    try {
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const oldVersion = packageJson.version;
        const newVersion = upVersion(oldVersion, versionType);

        packageJson.version = newVersion;
        fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
        logSuccess('🔖', 'Current version %s up to %s.', oldVersion, newVersion);
        return true;
    } catch (error) {
        logError('❌', 'Error updating version in package.json');
        return false;
    }
}

function setVersion(versionType) {
    return runCommand({
        name: `version up ${versionType}`,
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'package-json-exists', run: () => requireFileExists('package.json') },
            { name: 'package-version', run: requirePackageVersion },
            { name: 'clean-working-tree', run: requireCleanWorkingTree }
        ],
        steps: [
            { name: 'update-package-version', run: () => updateVersionFile(versionType) }
        ]
    });
}


module.exports = {
    upVersion,
    setVersion
};
