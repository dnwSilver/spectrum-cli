const { FRAGMENT_TYPES, SECTION_TO_TYPE } = require('./changelog-config');
const { renderReleaseBlock } = require('./changelog');

// Parse release boundaries without rewriting any published text.
function parseChangelog(text) {
    const headings = [...text.matchAll(/^## .+$/gm)];
    const seen = new Set();
    const releases = headings.map((heading, index) => {
        const match = heading[0].match(/^## (?:🚀 )?\[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/);
        if (!match || seen.has(match[1])) {
            throw new Error('CHANGELOG.md содержит некорректный или повторный раздел релиза.');
        }
        seen.add(match[1]);
        return {
            version: match[1], date: match[2],
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

function history(document) {
    return document.releases.map((release) => release.text.trim()).join('\n\n');
}

function pendingDocument(text, stableText, target) {
    const document = parseChangelog(text);
    const stable = parseChangelog(stableText);
    const pending = document.releases[0]?.version === target ? document.releases.shift() : null;
    if (history(document) !== history(stable) || document.intro.trim() !== stable.intro.trim()) {
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
    const block = renderReleaseBlock(target, merged, current.pending?.date || date);
    // Preserve the published tail byte-for-byte, including its spacing.
    const tail = current.document.releases.map((release) => release.text).join('');
    return `${current.document.intro.trimEnd()}\n\n${block.trim()}\n${tail ? `\n${tail}` : ''}`;
}

module.exports = { parseChangelog, releaseEntries, pendingDocument, prepareChangelog };
