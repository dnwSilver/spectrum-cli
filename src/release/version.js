const { upVersion, parseStableVersion } = require('../common/version');
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

function resolveReleaseVersion(stableVersion, fragments, { stable = false } = {}) {
    const baseline = parseStableVersion(stableVersion);
    if (!baseline || (stable && baseline[0] !== 0)) return null;
    const impact = detectBumpType(fragments);
    // Initial development stays in 0.x until explicitly promoted to 1.0.0.
    const bumpType = stable ? 'major' : baseline[0] === 0 && impact === 'major' ? 'minor' : impact;
    const newVersion = upVersion(stableVersion, bumpType);
    if (!newVersion) return null;
    return { bumpType, newVersion };
}

module.exports = { detectBumpType, resolveReleaseVersion };
