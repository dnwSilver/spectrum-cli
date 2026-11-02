#!/usr/bin/env node

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

module.exports = {
    STABLE_VERSION_PATTERN,
    parseStableVersion,
    compareVersions,
    upVersion
};
