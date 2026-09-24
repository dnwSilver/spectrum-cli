const { STABLE_VERSION_PATTERN } = require('./version');
const STABLE_TAG_PATTERNS = ['release/*', 'hotfix/*', 'v*'];

function parseStableTag(tag) {
    const match = /^(release\/|hotfix\/|v)(.*)$/.exec(String(tag || ''));
    if (!match || !STABLE_VERSION_PATTERN.test(match[2])) return null;
    return { version: match[2], kind: match[1] === 'hotfix/' ? 'hotfix' : 'release' };
}

function stableTagNames(version) {
    if (!STABLE_VERSION_PATTERN.test(String(version || ''))) throw new Error('Ожидается stable-версия X.Y.Z.');
    return [`release/${version}`, `hotfix/${version}`, `v${version}`];
}

module.exports = { STABLE_TAG_PATTERNS, parseStableTag, stableTagNames };
