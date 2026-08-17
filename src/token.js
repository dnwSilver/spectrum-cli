#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { logSuccess, logError, colors } = require('./utils');
const { runCommand } = require('./command-executor');

const TOKEN_NAME = 'GITLAB_PRIVATE_TOKEN';
const TOKEN_SCOPES = ['api', 'read_repository', 'write_repository', 'read_registry'];

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

        if (isTopLevel && /^groups:\s*$/.test(trimmed)) {
            section = 'groups';
            continue;
        }

        if (isTopLevel && /^projects:\s*$/.test(trimmed)) {
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

function parseGitlabUrl(raw) {
    const url = new URL(String(raw || '').trim());
    const pathname = url.pathname.replace(/^\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (!url.origin || !pathname) {
        throw new Error('invalid gitlab url');
    }
    return {
        origin: url.origin,
        path: pathname,
        encodedPath: encodeURIComponent(pathname),
        url: String(raw).trim()
    };
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

async function promptAdminPat() {
    return new Promise((resolve) => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        stdout.write('🔑 Введите admin PAT: ');

        if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
            const rl = readline.createInterface({ input: stdin, output: stdout });
            rl.question('', (answer) => {
                rl.close();
                resolve(String(answer || '').trim());
            });
            return;
        }

        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        let value = '';
        const onData = (char) => {
            if (char === '\n' || char === '\r' || char === '\u0004') {
                stdin.setRawMode(false);
                stdin.pause();
                stdin.removeListener('data', onData);
                stdout.write('\n');
                resolve(value.trim());
                return;
            }
            if (char === '\u0003') {
                stdin.setRawMode(false);
                process.exit(1);
            }
            if (char === '\u007f' || char === '\b') {
                value = value.slice(0, -1);
                return;
            }
            value += char;
        };
        stdin.on('data', onData);
    });
}

async function gitlabRequest(origin, adminPat, method, apiPath, body) {
    const url = `${origin}/api/v4${apiPath}`;
    const headers = { 'PRIVATE-TOKEN': adminPat };
    const options = { method, headers };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            data = null;
        }
    }

    return {
        ok: response.ok,
        status: response.status,
        data,
        headers: response.headers
    };
}

async function gitlabGetAll(origin, adminPat, apiPath) {
    const items = [];
    let page = 1;

    while (true) {
        const separator = apiPath.includes('?') ? '&' : '?';
        const result = await gitlabRequest(origin, adminPat, 'GET', `${apiPath}${separator}per_page=100&page=${page}`);
        if (!result.ok) {
            return result;
        }

        const batch = Array.isArray(result.data) ? result.data : [];
        items.push(...batch);

        const nextPage = result.headers && typeof result.headers.get === 'function'
            ? result.headers.get('x-next-page')
            : '';
        if (!nextPage) {
            break;
        }
        page = Number(nextPage);
        if (!page) {
            break;
        }
    }

    return { ok: true, status: 200, data: items };
}

function loadOrCreateConfig() {
    const configPath = getConfigPath();
    const configDir = path.dirname(configPath);

    if (!fs.existsSync(configPath)) {
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
            targets
        }
    };
}

async function askAdminPat() {
    logSuccess('🔑', 'Запрашиваю admin PAT. Значение останется только в памяти.');
    const adminPat = await module.exports.promptAdminPat();
    if (!adminPat) {
        return { ok: false, reason: 'Admin PAT не указан.' };
    }
    logSuccess('🔑', 'Admin PAT принят в память.');
    return { ok: true, data: { adminPat } };
}

async function resolveCurrentUser(ctx) {
    const origin = ctx.targets[0].origin;
    logSuccess('👤', 'Проверяю admin PAT через GET /user на %s', origin);
    const result = await gitlabRequest(origin, ctx.adminPat, 'GET', '/user');
    if (!result.ok || !result.data || !result.data.id) {
        return { ok: false, reason: `Не удалось получить текущего пользователя (HTTP ${result.status}).` };
    }
    logSuccess('👤', 'Текущий пользователь: %s (id=%s)', result.data.username || 'unknown', String(result.data.id));
    return { ok: true, data: { origin, userId: result.data.id, username: result.data.username } };
}

async function checkTargetsAccess(ctx) {
    const total = ctx.targets.length;
    for (let index = 0; index < total; index += 1) {
        const target = ctx.targets[index];
        const endpoint = target.kind === 'группы' ? 'groups' : 'projects';
        logSuccess('🔍', '[%s/%s] Проверяю доступ к %s %s', String(index + 1), String(total), target.kind, target.url);
        const result = await gitlabRequest(ctx.origin, ctx.adminPat, 'GET', `/${endpoint}/${target.encodedPath}`);
        if (!result.ok) {
            return { ok: false, reason: `${target.kind === 'группы' ? 'Группа' : 'Проект'} недоступен: ${target.url} (HTTP ${result.status}).` };
        }
        logSuccess('✅', '[%s/%s] %s доступна: %s', String(index + 1), String(total), target.kind === 'группы' ? 'Группа' : 'Проект', target.path);
    }
    return { ok: true };
}

async function rotatePat(ctx) {
    const expiresAt = addMonths(new Date(), ctx.tokenTtlMonths);
    logSuccess('🔎', 'Ищу активные PAT с именем %s', TOKEN_NAME);
    const listed = await gitlabGetAll(ctx.origin, ctx.adminPat, `/personal_access_tokens?user_id=${ctx.userId}&search=${encodeURIComponent(TOKEN_NAME)}`);
    if (!listed.ok) {
        logError('❌', 'Не удалось получить список PAT (HTTP %s).', String(listed.status));
        return false;
    }

    const existing = (listed.data || []).filter((token) => token.name === TOKEN_NAME && token.active && !token.revoked);
    if (existing.length === 0) {
        logSuccess('🔎', 'Активный PAT %s не найден, будет создан новый.', TOKEN_NAME);
    }

    for (const token of existing) {
        logSuccess('🗑', 'Удаляю старый PAT %s (id=%s)', TOKEN_NAME, String(token.id));
        const revoked = await gitlabRequest(ctx.origin, ctx.adminPat, 'DELETE', `/personal_access_tokens/${token.id}`);
        if (!revoked.ok && revoked.status !== 204) {
            logError('❌', 'Не удалось удалить PAT id=%s (HTTP %s).', String(token.id), String(revoked.status));
            return false;
        }
        logSuccess('🗑', 'PAT id=%s удален.', String(token.id));
    }

    logSuccess('🆕', 'Создаю PAT %s, истекает %s', TOKEN_NAME, expiresAt);
    const created = await gitlabRequest(ctx.origin, ctx.adminPat, 'POST', `/users/${ctx.userId}/personal_access_tokens`, {
        name: TOKEN_NAME,
        scopes: TOKEN_SCOPES,
        expires_at: expiresAt
    });
    if (!created.ok || !created.data || !created.data.token) {
        logError('❌', 'Не удалось создать PAT (HTTP %s).', String(created.status));
        return false;
    }

    logSuccess('🆕', 'PAT %s создан (id=%s), истекает %s', TOKEN_NAME, String(created.data.id), expiresAt);
    ctx.newToken = created.data.token;
    ctx.expiresAt = expiresAt;
    ctx.variableDescription = buildDescription(ctx.bot, expiresAt);
    return true;
}

async function updateTargetVariable(ctx, target, index, total) {
    const endpoint = target.kind === 'группы' ? 'groups' : 'projects';
    const label = target.kind === 'группы' ? 'группе' : 'проекте';
    logSuccess('📦', '[%s/%s] Обновляю CI variable %s в %s %s', String(index + 1), String(total), TOKEN_NAME, label, target.path);

    const listed = await gitlabGetAll(ctx.origin, ctx.adminPat, `/${endpoint}/${target.encodedPath}/variables`);
    if (!listed.ok) {
        logError('❌', 'Не удалось получить CI variables для %s (HTTP %s).', target.path, String(listed.status));
        return false;
    }

    const exists = (listed.data || []).some((variable) => variable.key === TOKEN_NAME);
    if (exists) {
        logSuccess('🗑', '[%s/%s] Удаляю старую CI variable %s в %s %s', String(index + 1), String(total), TOKEN_NAME, label, target.path);
        const deleted = await gitlabRequest(ctx.origin, ctx.adminPat, 'DELETE', `/${endpoint}/${target.encodedPath}/variables/${TOKEN_NAME}`);
        if (!deleted.ok && deleted.status !== 204) {
            logError('❌', 'Не удалось удалить CI variable в %s (HTTP %s).', target.path, String(deleted.status));
            return false;
        }
        logSuccess('🗑', '[%s/%s] Старая CI variable удалена в %s %s', String(index + 1), String(total), label, target.path);
    } else {
        logSuccess('🔎', '[%s/%s] CI variable %s в %s %s отсутствует, будет создана.', String(index + 1), String(total), TOKEN_NAME, label, target.path);
    }

    logSuccess('📝', '[%s/%s] Создаю CI variable %s в %s %s', String(index + 1), String(total), TOKEN_NAME, label, target.path);
    const created = await gitlabRequest(ctx.origin, ctx.adminPat, 'POST', `/${endpoint}/${target.encodedPath}/variables`, {
        key: TOKEN_NAME,
        value: ctx.newToken,
        masked_and_hidden: true,
        description: ctx.variableDescription
    });
    if (!created.ok) {
        logError('❌', 'Не удалось создать CI variable в %s (HTTP %s).', target.path, String(created.status));
        return false;
    }

    logSuccess('📝', '[%s/%s] CI variable обновлена в %s %s', String(index + 1), String(total), label, target.path);
    return true;
}

async function updateCiVariables(ctx) {
    const total = ctx.targets.length;
    logSuccess('📦', 'Начинаю обновление CI variables: целей %s', String(total));
    for (let index = 0; index < total; index += 1) {
        const ok = await updateTargetVariable(ctx, ctx.targets[index], index, total);
        if (!ok) {
            return false;
        }
    }
    logSuccess('📦', 'Все CI variables обновлены (%s).', String(total));
    return true;
}

function printNewToken(ctx) {
    console.log(` ${colors.yellow}⚠️  Новый ${TOKEN_NAME} больше нельзя будет получить. Сохраните его сейчас:${colors.reset}`);
    console.log(ctx.newToken);
    return true;
}

function tokenRotate() {
    return runCommand({
        name: 'token rotate',
        checks: [
            { name: 'load-config', run: loadOrCreateConfig },
            { name: 'ask-admin-pat', run: askAdminPat },
            { name: 'resolve-user', run: resolveCurrentUser },
            { name: 'check-access', run: checkTargetsAccess }
        ],
        steps: [
            { name: 'rotate-pat', run: rotatePat },
            { name: 'update-ci-variables', run: updateCiVariables },
            { name: 'print-token', run: printNewToken }
        ]
    });
}

module.exports = {
    TOKEN_NAME,
    TOKEN_SCOPES,
    getConfigPath,
    defaultConfigContent,
    parseConfig,
    parseGitlabUrl,
    addMonths,
    buildDescription,
    validateConfig,
    promptAdminPat,
    loadOrCreateConfig,
    askAdminPat,
    resolveCurrentUser,
    checkTargetsAccess,
    rotatePat,
    updateCiVariables,
    printNewToken,
    tokenRotate
};
