const fs = require('fs');
const os = require('os');
const path = require('path');
const { logSuccess } = require('../common/utils');
const { isDryRun } = require('../cli/command-executor');
const { parseGitlabUrl } = require('../integrations/gitlab-url');
const TOKEN_NAME = 'GITLAB_PRIVATE_TOKEN';

function getConfigPath() {
    return path.join(os.homedir(), '.config', 'spectrum-cli', 'config.yaml');
}

function defaultConfigContent() {
    return [
        'bot: bot',
        'token_ttl_months: 12',
        'groups: []',
        'projects: []',
        ''
    ].join('\n');
}

function stripQuotes(value) {
    const text = String(value || '').trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        return text.slice(1, -1);
    }
    return text;
}

function parseConfig(content) {
    const result = { bot: null, tokenTtlMonths: null, groups: [], projects: [] };
    let section = null;

    for (const rawLine of String(content || '').split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const isTopLevel = !line.startsWith(' ') && !line.startsWith('\t');
        const botMatch = trimmed.match(/^bot:\s*(.+)$/);
        if (isTopLevel && botMatch) {
            result.bot = stripQuotes(botMatch[1]);
            section = null;
            continue;
        }

        const ttlMatch = trimmed.match(/^token_ttl_months:\s*(.+)$/);
        if (isTopLevel && ttlMatch) {
            result.tokenTtlMonths = Number(stripQuotes(ttlMatch[1]));
            section = null;
            continue;
        }

        if (isTopLevel && /^groups:\s*(?:\[\s*\])?\s*$/.test(trimmed)) {
            section = 'groups';
            continue;
        }

        if (isTopLevel && /^projects:\s*(?:\[\s*\])?\s*$/.test(trimmed)) {
            section = 'projects';
            continue;
        }

        const itemMatch = line.match(/^\s*-\s+(.+)$/);
        if (itemMatch && (section === 'groups' || section === 'projects')) {
            result[section].push(stripQuotes(itemMatch[1]));
        }
    }

    return result;
}

function addMonths(date, months) {
    const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + Number(months), date.getUTCDate()));
    return result.toISOString().slice(0, 10);
}

function buildDescription(bot, expiresAt) {
    return `PAT от бота ${bot}, владелец Колосов. Истекает ${expiresAt}.`;
}

function validateConfig(config) {
    if (!config.bot) {
        return { ok: false, reason: 'В конфиге отсутствует поле bot.' };
    }
    if (!Number.isInteger(config.tokenTtlMonths) || config.tokenTtlMonths <= 0) {
        return { ok: false, reason: 'В конфиге поле token_ttl_months должно быть положительным целым числом.' };
    }
    if (config.groups.length === 0 && config.projects.length === 0) {
        return { ok: false, reason: 'В конфиге пустые списки groups и projects.' };
    }
    return { ok: true };
}

function parseTargets(urls, kind) {
    const targets = [];
    for (const raw of urls) {
        try {
            targets.push({ kind, ...parseGitlabUrl(raw) });
        } catch (error) {
            return { ok: false, reason: `Некорректный URL ${kind}: ${raw}` };
        }
    }
    return { ok: true, targets };
}

function loadOrCreateConfig() {
    const configPath = getConfigPath();
    const configDir = path.dirname(configPath);

    if (!fs.existsSync(configPath)) {
        if (isDryRun()) {
            return { ok: false, reason: `Конфиг ${configPath} не найден. В режиме --dry он не создаётся.` };
        }
        logSuccess('📄', 'Конфиг не найден, создаю %s', configPath);
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(configPath, defaultConfigContent(), 'utf8');
        logSuccess('📄', 'Конфиг создан. Проверьте groups и projects перед следующей ротацией.');
    } else {
        logSuccess('📄', 'Читаю конфиг %s', configPath);
    }

    let content = '';
    try {
        content = fs.readFileSync(configPath, 'utf8');
    } catch (error) {
        return { ok: false, reason: `Не удалось прочитать конфиг ${configPath}.` };
    }

    const parsed = parseConfig(content);
    const valid = validateConfig(parsed);
    if (!valid.ok) {
        return valid;
    }

    const groups = parseTargets(parsed.groups, 'группы');
    if (!groups.ok) {
        return groups;
    }
    const projects = parseTargets(parsed.projects, 'проекта');
    if (!projects.ok) {
        return projects;
    }

    const targets = groups.targets.concat(projects.targets);
    logSuccess('📄', 'Конфиг загружен: bot=%s, ttl=%s мес., групп=%s, проектов=%s', parsed.bot, String(parsed.tokenTtlMonths), String(parsed.groups.length), String(parsed.projects.length));

    return {
        ok: true,
        data: {
            configPath,
            bot: parsed.bot,
            tokenTtlMonths: parsed.tokenTtlMonths,
            origin: targets[0].origin,
            targets
        }
    };
}

module.exports = { TOKEN_NAME, getConfigPath, defaultConfigContent, parseConfig, addMonths, buildDescription, validateConfig, loadOrCreateConfig };
