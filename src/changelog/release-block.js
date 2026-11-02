const fs = require('fs');
const { logSuccess, logError } = require('../common/utils');
const { CHANGELOG_FILE, FRAGMENT_TYPES } = require('./config');
function stripLegacyUnreleasedBlock(changelog) {
    const unreleasedMatch = /^## \[Unreleased\]\s*$/m.exec(changelog);
    if (!unreleasedMatch) return changelog;

    const afterUnreleased = unreleasedMatch.index + unreleasedMatch[0].length;
    const nextHeadingMatch = /^## /m.exec(changelog.slice(afterUnreleased));
    const end = nextHeadingMatch ? afterUnreleased + nextHeadingMatch.index : changelog.length;
    return `${changelog.slice(0, unreleasedMatch.index).trimEnd()}\n\n${changelog.slice(end).trimStart()}`;
}

function renderReleaseBlock(version, fragments, date = new Date().toISOString().slice(0, 10), marker = '🚀') {
    const fragmentsByType = new Map();
    for (const fragment of fragments) {
        const entries = fragmentsByType.get(fragment.type) || [];
        entries.push(...fragment.entries);
        fragmentsByType.set(fragment.type, entries);
    }

    const lines = [`## ${marker ? `${marker} ` : ''}[${version}]${date ? ` - ${date}` : ''}`];
    for (const [type, config] of Object.entries(FRAGMENT_TYPES)) {
        const entries = fragmentsByType.get(type);
        if (!entries || entries.length === 0) continue;
        lines.push('', config.section, '', ...entries);
    }
    return `${lines.join('\n')}\n`;
}

function insertReleaseBlock(changelog, releaseBlock, version) {
    const normalized = stripLegacyUnreleasedBlock(changelog).trimEnd();
    const escapedVersion = String(version).replace(/\./g, '\\.');
    const versionPattern = new RegExp(`^## 🚀 \\[${escapedVersion}\\](?:\\s|$)`, 'm');
    if (versionPattern.test(normalized)) {
        throw new Error(`Версия ${version} уже присутствует в ${CHANGELOG_FILE}.`);
    }

    const firstReleaseMatch = /^## /m.exec(normalized);
    if (!firstReleaseMatch) {
        return `${normalized}\n\n${releaseBlock}`;
    }

    return `${normalized.slice(0, firstReleaseMatch.index).trimEnd()}\n\n${releaseBlock}\n${normalized.slice(firstReleaseMatch.index).trimStart()}\n`;
}

function changelogBuildRelease(context, date) {
    try {
        const version = context.newVersion;
        const fragments = context.changelogFragments;
        if (!version || !Array.isArray(fragments) || fragments.length === 0) return false;

        const changelog = fs.readFileSync(CHANGELOG_FILE, 'utf8');
        const releaseBlock = renderReleaseBlock(version, fragments, date);
        const updatedChangelog = insertReleaseBlock(changelog, releaseBlock, version);
        fs.writeFileSync(CHANGELOG_FILE, updatedChangelog);
        logSuccess('📋', '%s собран из %s changelog fragments.', `CHANGELOG ${version}`, fragments.length);
        return true;
    } catch (error) {
        logError('❌', 'Не удалось собрать релизный changelog: %s', error.message);
        return false;
    }
}

function changelogRemoveFragments(context) {
    try {
        const fragments = context.changelogFragments;
        if (!Array.isArray(fragments) || fragments.length === 0) return false;
        for (const fragment of fragments) {
            fs.unlinkSync(fragment.filePath);
        }
        logSuccess('🧹', 'Использованные changelog fragments удалены: %s.', fragments.length);
        return true;
    } catch (error) {
        logError('❌', 'Не удалось удалить changelog fragments: %s', error.message);
        return false;
    }
}

module.exports = { stripLegacyUnreleasedBlock, renderReleaseBlock, insertReleaseBlock, changelogBuildRelease, changelogRemoveFragments };
