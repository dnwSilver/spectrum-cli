const { FRAGMENT_TYPES, SECTION_TO_TYPE } = require('./changelog-config');
const { renderReleaseBlock } = require('./changelog');

// Parse release boundaries without rewriting any published text.
function parseChangelog(text) {
    const headings = [...text.matchAll(/^## .+$/gm)];
    const releases = headings.map((heading, index) => {
        const match = heading[0].match(/^##[ \t]+(?:(🚀|🩹)[ \t]*)?\[(\d+\.\d+\.\d+)\](?:[ \t]+-[ \t]+(\d{4}-\d{2}-\d{2}|\d{4}\.\d{2}\.\d{2}|\d{2}\.\d{2}\.\d{4}))?[ \t]*\r?$/);
        if (!match) {
            throw new Error(`Некорректный заголовок CHANGELOG.md: ${heading[0]}. Ожидается ## [X.Y.Z], дата необязательна.`);
        }
        // Historical duplicates are preserved; callers validate the pending version and immutable history.
        return {
            version: match[2], date: match[3] || null, marker: match[1] || '',
            text: text.slice(heading.index, headings[index + 1]?.index ?? text.length),
            body: text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length),
        };
    });
    return { intro: text.slice(0, headings[0]?.index ?? text.length), releases };
}

function releaseEntries(release, patchOnly = false) {
    const entries = [];
    let type;
    for (const raw of release.body.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('### ')) {
            type = SECTION_TO_TYPE[line];
            if (!type || (patchOnly && FRAGMENT_TYPES[type].bump !== 'patch')) {
                throw new Error(patchOnly ? 'Хотфикс допускает только patch-разделы CHANGELOG.md.' : 'Неизвестный раздел CHANGELOG.md.');
            }
        } else if (type && line.startsWith('- ')) {
            entries.push({ type, section: FRAGMENT_TYPES[type].section, entries: [line] });
        } else if (/^\s+\S/.test(raw) && entries.at(-1)?.type === type) {
            // Formatters may wrap a bullet or its author link onto indented lines.
            entries.at(-1).entries[0] += ` ${line}`;
        } else {
            throw new Error('Не удалось безопасно дополнить раздел релиза: неизвестный формат записи.');
        }
    }
    if (!entries.length) throw new Error('Раздел релиза пуст.');
    return entries;
}

function normalizeLineEndings(text) {
    return text.replace(/\r\n/g, '\n');
}

function history(document) {
    return document.releases.map((release) => normalizeLineEndings(release.text).trim()).join('\n\n');
}

function pendingDocument(text, stableText, target) {
    const document = parseChangelog(text);
    const stable = parseChangelog(stableText);
    const pending = document.releases[0]?.version === target ? document.releases.shift() : null;
    if (document.releases.some((release) => release.version === target)) {
        throw new Error('Новый patch-раздел должен быть единственным и находиться в начале CHANGELOG.md.');
    }
    if (history(document) !== history(stable) || normalizeLineEndings(document.intro).trim() !== normalizeLineEndings(stable.intro).trim()) {
        throw new Error('История CHANGELOG.md отличается от stable: допустим только верхний раздел следующего patch.');
    }
    return { document, pending, entries: pending ? releaseEntries(pending, true) : [] };
}

function prepareChangelog({ text, stableText, productionText, target, fragments, date }) {
    const current = pendingDocument(text, stableText, target);
    const production = pendingDocument(productionText, stableText, target);
    const entryKey = (entry) => `${entry.type}:${entry.entries[0]}`;
    const currentKeys = new Set(current.entries.map(entryKey));
    if (production.entries.some((entry) => !currentKeys.has(entryKey(entry)))) {
        throw new Error('Сначала перенесите в hotfix актуальный раздел из production; его записи нельзя терять.');
    }
    if (!fragments.length) {
        if (!current.pending) throw new Error('Нет новых hotfix fragments или подготовленного раздела.');
        return text;
    }
    const merged = [...current.entries];
    for (const fragment of fragments) {
        if (fragment.bump !== 'patch') throw new Error('Хотфикс не может включать minor или major fragments.');
        for (const line of fragment.entries) {
            const entry = { ...fragment, entries: [line] };
            if (!currentKeys.has(entryKey(entry))) merged.push(entry);
            currentKeys.add(entryKey(entry));
        }
    }
    const block = renderReleaseBlock(target, merged, current.pending ? current.pending.date : date, '🩹');
    // Preserve the published tail byte-for-byte, including its spacing.
    const tail = current.document.releases.map((release) => release.text).join('');
    return `${current.document.intro.trimEnd()}\n\n${block.trim()}\n${tail ? `\n${tail}` : ''}`;
}

module.exports = { parseChangelog, releaseEntries, pendingDocument, prepareChangelog, normalizeLineEndings };
