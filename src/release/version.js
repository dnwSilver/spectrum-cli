const { upVersion } = require('../common/version');
function detectBumpType(fragments) {
    const bumpTypes = new Set((fragments || []).map((fragment) => fragment.bump));
    if (bumpTypes.has('major')) {
        return 'major';
    }
    if (bumpTypes.has('minor')) {
        return 'minor';
    }
    return 'patch';
}

function resolveReleaseVersion(stableVersion, fragments) {
    const bumpType = detectBumpType(fragments);
    const newVersion = upVersion(stableVersion, bumpType);
    if (!newVersion) return null;
    return { bumpType, newVersion };
}

module.exports = { detectBumpType, resolveReleaseVersion };
