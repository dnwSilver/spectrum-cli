const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { logSuccess, logError, execSilent, getCurrentBranch, colors } = require('../common/utils');
const { CHANGELOG_DIR, FRAGMENT_TYPES, SECTION_TO_TYPE } = require('./config');
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

module.exports = { extractTaskFromBranch, getGitUser, formatMessage, detectSectionFromBranch, selectSection, sanitizeFragmentSlug, createFragmentPath, prepareChangelogEntry, appendPreparedChangelogEntry };
