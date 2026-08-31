#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { logSuccess, logError, execSilent, getCurrentBranch, colors } = require('./utils');
const { runCommand } = require('./command-executor');
const {
    requireGitRepo,
    requireFileExists,
    requireChangelogFormatted,
    requireChangelogFragments
} = require('./preflight');
const {
    CHANGELOG_FILE,
    CHANGELOG_DIR,
    FRAGMENT_TYPES,
    SECTION_TO_TYPE
} = require('./changelog-config');

function createReadlineInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

function askQuestion(question) {
    return new Promise((resolve) => {
        const rl = createReadlineInterface();
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function extractTaskFromBranch() {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        logError('❌', 'Не удалось получить имя текущей ветки.');
        return null;
    }

    const taskMatch = currentBranch.match(/^[a-z][a-z0-9-]*\/([A-Z]+-[0-9]+)(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?$/);
    if (!taskMatch) {
        logError(
            '❌',
            'Имя ветки "%s" должно соответствовать <type>/<YOUTRACK-ID> или <type>/<YOUTRACK-ID>-<slug>.',
            currentBranch
        );
        return null;
    }

    return taskMatch[1];
}

async function getGitUser() {
    let name = execSilent('git config user.name');
    let email = execSilent('git config user.email');

    if (!name || !email) {
        console.log(`⚠️  ${colors.yellow}Имя и email пользователя git не настроены.${colors.reset}`);
        console.log('💡 Их можно настроить так:');
        console.log('   git config user.name "Ваше Имя"');
        console.log('   git config user.email "your.email@domain.com"');
        console.log('');

        if (!name) {
            name = await askQuestion('👤 Введите ваше имя: ');
            if (!name) {
                logError('❌', 'Имя обязательно.');
                return null;
            }
        }

        if (!email) {
            email = await askQuestion('📧 Введите ваш email: ');
            if (!email || !email.includes('@')) {
                logError('❌', 'Требуется корректный email.');
                return null;
            }
        }
    }

    return `[${name}](${email})`;
}

function formatMessage(message) {
    const trimmedMessage = String(message || '').trim();
    if (!trimmedMessage) return '';
    return /[.!?]$/.test(trimmedMessage) ? trimmedMessage : `${trimmedMessage}.`;
}

function detectSectionFromBranch() {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) return [];

    const branchType = currentBranch.split('/', 1)[0].toLowerCase();
    const sections = {
        support: [FRAGMENT_TYPES.support.section, FRAGMENT_TYPES.security.section],
        bugfix: [FRAGMENT_TYPES.fixed.section],
        feature: [
            FRAGMENT_TYPES.breaking.section,
            FRAGMENT_TYPES.added.section,
            FRAGMENT_TYPES.changed.section,
            FRAGMENT_TYPES.deprecated.section,
            FRAGMENT_TYPES.removed.section
        ]
    };

    if (branchType === 'support') {
        return sections.support;
    }
    if (branchType === 'bugfix' || branchType === 'fix' || branchType === 'hotfix') {
        return sections.bugfix;
    }
    if (branchType === 'feature' || branchType === 'feat') {
        return sections.feature;
    }

    return [];
}

async function selectSection(availableSections) {
    const sections = availableSections.length > 0
        ? availableSections
        : Object.values(FRAGMENT_TYPES).map((config) => config.section);

    if (sections.length === 1) {
        return sections[0];
    }

    console.log('\n📋 Выберите раздел:');
    sections.forEach((section, index) => {
        console.log(`   ${index + 1}. ${section}`);
    });

    const choice = await askQuestion('\n🔢 Введите номер раздела: ');
    const choiceNum = parseInt(choice, 10);

    if (Number.isNaN(choiceNum) || choiceNum < 1 || choiceNum > sections.length) {
        logError('❌', 'Неверный выбор.');
        return null;
    }

    return sections[choiceNum - 1];
}

function sanitizeFragmentSlug(branchName, task) {
    const branchWithoutTask = String(branchName || '').replace(new RegExp(task, 'i'), '-');
    const slug = branchWithoutTask
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug || 'change';
}

function createFragmentPath(task, type, branchName = getCurrentBranch()) {
    const slug = sanitizeFragmentSlug(branchName, task);
    return path.posix.join(CHANGELOG_DIR, `${task}-${slug}.${type}.md`);
}

function displayFragment(fragmentPath, entry) {
    console.log('\n📝 Changelog fragment создан:');
    console.log(`   ${colors.green}${fragmentPath}${colors.reset}`);
    console.log(`   ${colors.green}${entry}${colors.reset}`);
    console.log('');
}

async function prepareChangelogEntry(message) {
    try {
        const formattedMessage = formatMessage(message);
        if (!formattedMessage) {
            return { ok: false, reason: 'Сообщение changelog не может быть пустым.' };
        }

        const task = await extractTaskFromBranch();
        if (!task) return { ok: false, reason: 'Не удалось определить ID задачи.' };

        const user = await getGitUser();
        if (!user) return { ok: false, reason: 'Не удалось определить пользователя git.' };

        const selectedSection = await selectSection(detectSectionFromBranch());
        if (!selectedSection) return { ok: false, reason: 'Не удалось выбрать раздел.' };

        const type = SECTION_TO_TYPE[selectedSection];
        if (!type) return { ok: false, reason: `Неизвестный раздел changelog: "${selectedSection}".` };

        return {
            ok: true,
            data: {
                fragmentState: {
                    entry: `- ${task} ${formattedMessage} ${user}`,
                    fragmentPath: createFragmentPath(task, type),
                    selectedSection,
                    type
                }
            }
        };
    } catch (error) {
        return { ok: false, reason: `Ошибка при подготовке changelog fragment: ${error.message}` };
    }
}

function appendPreparedChangelogEntry(context) {
    try {
        const fragmentState = context.fragmentState;
        if (!fragmentState) return false;

        fs.mkdirSync(CHANGELOG_DIR, { recursive: true });
        let entries = [];
        if (fs.existsSync(fragmentState.fragmentPath)) {
            entries = fs.readFileSync(fragmentState.fragmentPath, 'utf8')
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
            if (entries.some((line) => !line.startsWith('- '))) {
                logError('❌', 'Существующий fragment имеет неверный формат: %s', fragmentState.fragmentPath);
                return false;
            }
        }

        if (!entries.includes(fragmentState.entry)) {
            entries.push(fragmentState.entry);
        }
        fs.writeFileSync(fragmentState.fragmentPath, `${entries.join('\n')}\n`);
        displayFragment(fragmentState.fragmentPath, fragmentState.entry);
        logSuccess('✅', 'Запись добавлена в fragment раздела %s', fragmentState.selectedSection);
        return true;
    } catch (error) {
        logError('❌', 'Ошибка при записи changelog fragment: %s', error.message);
        return false;
    }
}

function changelogAppend(message) {
    return runCommand({
        name: 'changelog append',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'changelog-exists', run: () => requireFileExists(CHANGELOG_FILE) },
            { name: 'prepare-fragment', run: () => prepareChangelogEntry(message) }
        ],
        steps: [
            { name: 'write-fragment', run: appendPreparedChangelogEntry }
        ]
    });
}

function changelogCheck() {
    return runCommand({
        name: 'changelog check',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'changelog-exists', run: () => requireFileExists(CHANGELOG_FILE) },
            { name: 'changelog-prettier-check', run: requireChangelogFormatted },
            { name: 'changelog-fragments', run: requireChangelogFragments }
        ]
    });
}

function stripLegacyUnreleasedBlock(changelog) {
    const unreleasedMatch = /^## \[Unreleased\]\s*$/m.exec(changelog);
    if (!unreleasedMatch) return changelog;

    const afterUnreleased = unreleasedMatch.index + unreleasedMatch[0].length;
    const nextHeadingMatch = /^## /m.exec(changelog.slice(afterUnreleased));
    const end = nextHeadingMatch ? afterUnreleased + nextHeadingMatch.index : changelog.length;
    return `${changelog.slice(0, unreleasedMatch.index).trimEnd()}\n\n${changelog.slice(end).trimStart()}`;
}

function renderReleaseBlock(version, fragments, date = new Date().toISOString().slice(0, 10)) {
    const fragmentsByType = new Map();
    for (const fragment of fragments) {
        const entries = fragmentsByType.get(fragment.type) || [];
        entries.push(...fragment.entries);
        fragmentsByType.set(fragment.type, entries);
    }

    const lines = [`## 🚀 [${version}] - ${date}`];
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

module.exports = {
    changelogAppend,
    changelogCheck,
    extractTaskFromBranch,
    getGitUser,
    formatMessage,
    detectSectionFromBranch,
    selectSection,
    sanitizeFragmentSlug,
    createFragmentPath,
    prepareChangelogEntry,
    appendPreparedChangelogEntry,
    stripLegacyUnreleasedBlock,
    renderReleaseBlock,
    insertReleaseBlock,
    changelogBuildRelease,
    changelogRemoveFragments
};
