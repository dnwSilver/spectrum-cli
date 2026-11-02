const fs = require('fs');
const { logError, execCommand } = require('../common/utils');
const { CHANGELOG_FILE } = require('./config');
function normalizeChangelogHeadings(text) {
    const version = '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)';
    const date = '(\\d{4}-\\d{2}-\\d{2}|\\d{4}\\.\\d{2}\\.\\d{2}|\\d{2}\\.\\d{2}\\.\\d{4})';
    const releaseHeading = new RegExp(`^##[ \\t]*(?:(🚀|🩹)[ \\t]*)?\\[${version}\\](?:[ \\t]+-[ \\t]+${date})?[ \\t]*\\r?$`);
    return text.replace(/^##(?!#)[^\n]*$/gm, (heading) => {
        const match = releaseHeading.exec(heading);
        if (!match) throw new Error(`Некорректный заголовок ${CHANGELOG_FILE}: ${heading.trimEnd()}`);
        const marker = match[1] ? `${match[1]} ` : '';
        const releaseVersion = `${match[2]}.${match[3]}.${match[4]}`;
        const releaseDate = match[5] ? ` - ${match[5]}` : '';
        return `## ${marker}[${releaseVersion}]${releaseDate}${heading.endsWith('\r') ? '\r' : ''}`;
    });
}

function writeCurrentChangelog(context) {
    let original;
    let mayHaveChanged = false;
    try {
        original = fs.readFileSync(CHANGELOG_FILE, 'utf8');
        const normalized = normalizeChangelogHeadings(original);
        if (normalized !== original) {
            mayHaveChanged = true;
            fs.writeFileSync(CHANGELOG_FILE, normalized);
        }
        mayHaveChanged = true;
        if (!execCommand(`${context.prettierRunner} --write ${CHANGELOG_FILE}`) ||
            !execCommand(`${context.prettierRunner} --check ${CHANGELOG_FILE}`)) {
            throw new Error('Prettier не смог отформатировать CHANGELOG.md.');
        }
        const formatted = fs.readFileSync(CHANGELOG_FILE, 'utf8');
        if (normalizeChangelogHeadings(formatted) !== formatted) {
            throw new Error('После Prettier заголовки CHANGELOG.md не соответствуют формату релизов.');
        }
        return true;
    } catch (error) {
        if (mayHaveChanged && original !== undefined) {
            try {
                fs.writeFileSync(CHANGELOG_FILE, original);
            } catch (restoreError) {
                logError('❌', 'Не удалось восстановить %s: %s', CHANGELOG_FILE, restoreError.message);
            }
        }
        logError('❌', 'Не удалось отформатировать %s: %s', CHANGELOG_FILE, error.message);
        return false;
    }
}

module.exports = { normalizeChangelogHeadings, writeCurrentChangelog };
