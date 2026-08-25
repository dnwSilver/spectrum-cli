#!/usr/bin/env node
const fs = require('fs');
const { logSuccess, logError } = require('./utils');
const { runCommand } = require('./command-executor');
const { requireGitRepo, requireFileExists, requirePackageVersion } = require('./preflight');

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseStableVersion(version) {
    const match = String(version || '').match(STABLE_VERSION_PATTERN);
    if (!match) return null;
    return match.slice(1).map(Number);
}

function compareVersions(left, right) {
    const leftParts = parseStableVersion(left);
    const rightParts = parseStableVersion(right);
    if (!leftParts || !rightParts) {
        throw new Error('Для сравнения требуются стабильные SemVer версии X.Y.Z.');
    }

    for (let index = 0; index < leftParts.length; index += 1) {
        if (leftParts[index] !== rightParts[index]) {
            return leftParts[index] - rightParts[index];
        }
    }
    return 0;
}

function upVersion(oldVersion, upType) {
    const parts = parseStableVersion(oldVersion);
    if (!parts) return null;
    const [major, minor, patch] = parts;
    
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

function updateVersionFileExact(newVersion) {
    try {
        if (!parseStableVersion(newVersion)) {
            logError('❌', 'Новая версия должна соответствовать стабильному SemVer X.Y.Z.');
            return false;
        }

        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const oldVersion = packageJson.version;
        packageJson.version = newVersion;
        fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
        logSuccess('🔖', 'Версия обновлена с %s до %s.', oldVersion, newVersion);
        return true;
    } catch (error) {
        logError('❌', 'Ошибка при обновлении версии в package.json');
        return false;
    }
}

function updateVersionFile(versionType) {
    try {
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const oldVersion = packageJson.version;
        const newVersion = upVersion(oldVersion, versionType);
        if (!newVersion) {
            logError('❌', 'Текущая версия должна соответствовать стабильному SemVer X.Y.Z.');
            return false;
        }
        return updateVersionFileExact(newVersion);
    } catch (error) {
        logError('❌', 'Ошибка при обновлении версии в package.json');
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
        ],
        steps: [
            { name: 'update-package-version', run: () => updateVersionFile(versionType) }
        ]
    });
}


module.exports = {
    STABLE_VERSION_PATTERN,
    parseStableVersion,
    compareVersions,
    upVersion,
    updateVersionFileExact,
    updateVersionFile,
    setVersion
};
