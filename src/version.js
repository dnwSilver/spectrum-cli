#!/usr/bin/env node
const fs = require('fs');
const { logSuccess, logError } = require('./utils');

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

function setVersion(versionType) {
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


module.exports = {
    upVersion,
    setVersion
};
