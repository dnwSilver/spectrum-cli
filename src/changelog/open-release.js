const fs = require('fs');
const { execSilent, logError, logSuccess } = require('../common/utils');
const { compareVersions } = require('../common/version');
const { CHANGELOG_FILE, CHANGELOG_DIR } = require('./config');
const { parseChangelog, releaseEntries, normalizeLineEndings } = require('./hotfix');
const { renderReleaseBlock, stripLegacyUnreleasedBlock } = require('./index');
const { requireChangelogFragments } = require('../preflight');

function splitOpenRelease(text, stableVersion) {
    const document = parseChangelog(stripLegacyUnreleasedBlock(text));
    const pending = document.releases.filter((release) => compareVersions(release.version, stableVersion) > 0);
    if (pending.length > 1 || (pending.length && document.releases[0] !== pending[0])) {
        throw new Error('Допустим только один открытый релиз в верхнем разделе CHANGELOG.md.');
    }
    const open = pending[0] || null;
    if (open) document.releases.shift();
    return { document, open, entries: open ? releaseEntries(open) : [] };
}

function resolveReleaseState(localText, productionText, stableVersion) {
    const local = splitOpenRelease(localText, stableVersion);
    const production = splitOpenRelease(productionText, stableVersion);
    if (local.open && production.open && local.open.version !== production.open.version) {
        throw new Error('Открытые версии в dev и production различаются. Сначала согласуйте CHANGELOG.md.');
    }
    const history = ({ document }) => document.releases.map((release) => normalizeLineEndings(release.text).trim()).join('\n\n');
    if (history(local) !== history(production)) {
        throw new Error('Опубликованная история CHANGELOG.md изменена относительно production.');
    }
    return { openReleaseVersion: production.open?.version || local.open?.version || null, local, production };
}

function requireReleaseState(context) {
    try {
        const productionText = execSilent(`git show refs/remotes/origin/${context.mainBranch}:${CHANGELOG_FILE}`);
        if (productionText === null) throw new Error('Не удалось прочитать CHANGELOG.md из production.');
        const state = resolveReleaseState(fs.readFileSync(CHANGELOG_FILE, 'utf8'), productionText, context.stableVersion);
        return { ok: true, data: { openReleaseVersion: state.openReleaseVersion, releaseChangelogState: state } };
    } catch (error) {
        return { ok: false, reason: error.message };
    }
}

function readLocalReleaseState(context) {
    const text = stripLegacyUnreleasedBlock(fs.readFileSync(CHANGELOG_FILE, 'utf8'));
    const heading = /^##[ \t]+(?:(?:🚀|🩹)[ \t]*)?\[(\d+\.\d+\.\d+)\][^\r\n]*/m.exec(text);
    let tailStart = heading?.index ?? text.length;
    let open = null;
    if (heading && compareVersions(heading[1], context.stableVersion) > 0) {
        const afterHeading = heading.index + heading[0].length;
        const nextHeading = /^## /m.exec(text.slice(afterHeading));
        tailStart = nextHeading ? afterHeading + nextHeading.index : text.length;
        // Only the block we will amend needs parsing. The rest is opaque history:
        // do not validate pending-version counts, ordering or historical headings.
        open = parseChangelog(text.slice(heading.index, tailStart)).releases[0];
    }
    const local = {
        document: {
            intro: text.slice(0, heading?.index ?? text.length),
            releases: tailStart < text.length ? [{ text: text.slice(tailStart) }] : []
        },
        open,
        entries: open ? releaseEntries(open) : []
    };
    return { ok: true, data: {
        openReleaseVersion: local.open?.version || null,
        releaseChangelogState: { local, production: { ...local, open: null, entries: [] } }
    } };
}

function requireReleaseFragments(context) {
    try {
        // Empty is valid only for an already prepared release, including retry after a failed push.
        const entries = fs.existsSync(CHANGELOG_DIR) ? fs.readdirSync(CHANGELOG_DIR).filter((name) => !name.startsWith('.')) : [];
        if (context.openReleaseVersion && !entries.length) return { ok: true, data: { changelogFragments: [] } };
        return requireChangelogFragments();
    } catch (error) {
        return { ok: false, reason: error.message };
    }
}

function appendOpenRelease(context) {
    try {
        const { local, production } = context.releaseChangelogState;
        const open = production.open || local.open;
        const keys = new Set();
        const merged = [];
        for (const fragment of [...production.entries, ...local.entries, ...context.changelogFragments]) {
            for (const entry of fragment.entries) {
                const key = `${fragment.type}:${entry}`;
                if (!keys.has(key)) merged.push({ ...fragment, entries: [entry] });
                keys.add(key);
            }
        }
        const block = renderReleaseBlock(open.version, merged, open.date, open.marker);
        const tail = local.document.releases.map((release) => release.text).join('');
        const updated = `${local.document.intro.trimEnd()}\n\n${block.trim()}\n${tail ? `\n${tail}` : ''}`;
        fs.writeFileSync(CHANGELOG_FILE, updated);
        logSuccess('📋', 'Дополнен открытый релиз %s без повышения версии.', open.version);
        return true;
    } catch (error) {
        logError('❌', 'Не удалось дополнить открытый релиз: %s', error.message);
        return false;
    }
}

module.exports = { resolveReleaseState, readLocalReleaseState, requireReleaseState, requireReleaseFragments, appendOpenRelease };
