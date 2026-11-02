const fs = require('fs');
const path = require('path');
const { execSilent, execCommand } = require('../common/utils');
const { CHANGELOG_FILE, CHANGELOG_DIR, FRAGMENT_TYPES, getFragmentType } = require('../changelog/config');
const { ok, fail, STABLE_SEMVER_PATTERN, toPosixPath } = require('./result');
function getPrettierRunner() {
    const npxVersion = execSilent('npx --yes prettier --version');
    if (npxVersion) return 'npx --yes prettier';
    const directVersion = execSilent('prettier --version');
    if (directVersion) return 'prettier';
    return null;
}

function requireFileExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return fail(`Обязательный файл "${filePath}" не существует.`);
    }
    return ok();
}

const CHANGELOG_HEADING_PATTERN = /^##\s+(?:\S+\s+)?\[(\d+\.\d+\.\d+)\]/gm;

function getChangelogReleaseVersions(changelogPath = CHANGELOG_FILE) {
    let changelog;
    try {
        changelog = fs.readFileSync(changelogPath, 'utf8');
    } catch (error) {
        return [];
    }

    return [...changelog.matchAll(CHANGELOG_HEADING_PATTERN)].map((match) => match[1]);
}

function getChangelogReleaseVersion(changelogPath = CHANGELOG_FILE) {
    return getChangelogReleaseVersions(changelogPath)[0] || null;
}

function requireChangelogReleaseVersion() {
    const version = getChangelogReleaseVersion();
    if (!version) {
        return fail(`Не удалось прочитать версию релиза из ${CHANGELOG_FILE}. Ожидается заголовок "## 🚀 [X.Y.Z]".`);
    }
    if (!STABLE_SEMVER_PATTERN.test(version)) {
        return fail(`Версия "${version}" из ${CHANGELOG_FILE} должна быть стабильным SemVer X.Y.Z.`);
    }
    return ok({ version });
}

function requirePrettierAvailable() {
    const runner = getPrettierRunner();
    if (!runner) {
        return fail('Prettier недоступен.');
    }
    return ok({ prettierRunner: runner });
}

function requireChangelogFormatted() {
    const runner = getPrettierRunner();
    if (!runner) {
        return fail('Prettier недоступен.');
    }
    if (!execCommand(`${runner} --check CHANGELOG.md`)) {
        return fail('Файл CHANGELOG.md не прошел проверку Prettier.');
    }
    return ok({ prettierRunner: runner });
}

function findChangelogFragmentFiles(baseDir = CHANGELOG_DIR) {
    if (!fs.existsSync(baseDir)) {
        return [];
    }

    try {
        return fs.readdirSync(baseDir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
            .map((entry) => toPosixPath(path.join(baseDir, entry.name)))
            .sort();
    } catch (error) {
        return [];
    }
}

function requireChangelogFragments() {
    if (!fs.existsSync(CHANGELOG_DIR)) {
        return fail(`Директория changelog fragments "${CHANGELOG_DIR}" не существует.`);
    }

    const fragmentFiles = findChangelogFragmentFiles();
    if (fragmentFiles.length === 0) {
        return fail(`В директории "${CHANGELOG_DIR}" нет changelog fragments.`);
    }

    const changelogFragments = [];
    for (const filePath of fragmentFiles) {
        const type = getFragmentType(filePath);
        if (!type) {
            return fail(`Неверное имя changelog fragment "${filePath}". Ожидается "<name>.<type>.md".`);
        }

        let content;
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            return fail(`Не удалось прочитать changelog fragment "${filePath}".`);
        }

        const entries = content
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        if (entries.length === 0) {
            return fail(`Changelog fragment "${filePath}" пуст.`);
        }
        if (entries.some((line) => !line.startsWith('- '))) {
            return fail(`Каждая непустая строка "${filePath}" должна начинаться с "- ".`);
        }

        changelogFragments.push({
            filePath,
            type,
            section: FRAGMENT_TYPES[type].section,
            bump: FRAGMENT_TYPES[type].bump,
            entries
        });
    }

    return ok({ changelogFragments });
}

module.exports = { getPrettierRunner, requireFileExists, getChangelogReleaseVersions, getChangelogReleaseVersion, requireChangelogReleaseVersion, requirePrettierAvailable, requireChangelogFormatted, findChangelogFragmentFiles, requireChangelogFragments };
