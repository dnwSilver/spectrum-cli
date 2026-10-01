const readline = require('readline');
const { logSuccess, logError } = require('../common/utils');
const { runCommand } = require('../cli/command-executor');
const { TOKEN_NAME, addMonths, buildDescription, loadOrCreateConfig } = require('./config');
const { gitlabRequest, gitlabGetAll } = require('./gitlab-api');
async function promptHidden(message) {
    return new Promise((resolve) => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        stdout.write(message);

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

async function askTokens(ctx) {
    logSuccess('🔑', 'Запрашиваю owner PAT для работы с CI variables. Значение останется только в памяти.');
    const ownerToken = await require('./index').promptHidden('🔑 Введите owner PAT: ');
    if (!ownerToken) {
        return { ok: false, reason: 'Owner PAT не указан.' };
    }
    logSuccess('🔑', 'Owner PAT принят в память.');

    logSuccess('🔑', 'Запрашиваю %s для записи в CI variables. Значение останется только в памяти.', TOKEN_NAME);
    const ciToken = await require('./index').promptHidden(`🔑 Введите ${TOKEN_NAME}: `);
    if (!ciToken) {
        return { ok: false, reason: `${TOKEN_NAME} не указан.` };
    }

    const expiresAt = addMonths(new Date(), ctx.tokenTtlMonths);
    logSuccess('🔑', '%s принят в память. Description будет с датой %s.', TOKEN_NAME, expiresAt);
    return {
        ok: true,
        data: {
            ownerToken,
            ciToken,
            expiresAt,
            variableDescription: buildDescription(ctx.bot, expiresAt)
        }
    };
}

async function checkTargetsAccess(ctx) {
    const total = ctx.targets.length;
    for (let index = 0; index < total; index += 1) {
        const target = ctx.targets[index];
        const endpoint = target.kind === 'группы' ? 'groups' : 'projects';
        logSuccess('🔍', '[%s/%s] Проверяю доступ к %s %s', String(index + 1), String(total), target.kind, target.url);
        const result = await gitlabRequest(ctx.origin, ctx.ownerToken, 'GET', `/${endpoint}/${target.encodedPath}`);
        if (!result.ok) {
            return { ok: false, reason: `${target.kind === 'группы' ? 'Группа' : 'Проект'} недоступен: ${target.url} (HTTP ${result.status}).` };
        }
        logSuccess('✅', '[%s/%s] %s доступна: %s', String(index + 1), String(total), target.kind === 'группы' ? 'Группа' : 'Проект', target.path);
    }
    return { ok: true };
}

async function updateTargetVariable(ctx, target, index, total) {
    const endpoint = target.kind === 'группы' ? 'groups' : 'projects';
    const label = target.kind === 'группы' ? 'группе' : 'проекте';
    logSuccess('📦', '[%s/%s] Обновляю CI variable %s в %s %s', String(index + 1), String(total), TOKEN_NAME, label, target.path);

    const listed = await gitlabGetAll(ctx.origin, ctx.ownerToken, `/${endpoint}/${target.encodedPath}/variables`);
    if (!listed.ok) {
        logError('❌', 'Не удалось получить CI variables для %s (HTTP %s).', target.path, String(listed.status));
        return false;
    }

    const exists = (listed.data || []).some((variable) => variable.key === TOKEN_NAME);
    if (exists) {
        logSuccess('🗑', '[%s/%s] Удаляю старую CI variable %s в %s %s', String(index + 1), String(total), TOKEN_NAME, label, target.path);
        const deleted = await gitlabRequest(ctx.origin, ctx.ownerToken, 'DELETE', `/${endpoint}/${target.encodedPath}/variables/${TOKEN_NAME}`);
        if (!deleted.ok && deleted.status !== 204) {
            logError('❌', 'Не удалось удалить CI variable в %s (HTTP %s).', target.path, String(deleted.status));
            return false;
        }
        logSuccess('🗑', '[%s/%s] Старая CI variable удалена в %s %s', String(index + 1), String(total), label, target.path);
    } else {
        logSuccess('🔎', '[%s/%s] CI variable %s в %s %s отсутствует, будет создана.', String(index + 1), String(total), TOKEN_NAME, label, target.path);
    }

    logSuccess('📝', '[%s/%s] Создаю CI variable %s в %s %s', String(index + 1), String(total), TOKEN_NAME, label, target.path);
    const created = await gitlabRequest(ctx.origin, ctx.ownerToken, 'POST', `/${endpoint}/${target.encodedPath}/variables`, {
        key: TOKEN_NAME,
        value: ctx.ciToken,
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

function tokenRotate() {
    return runCommand({
        name: 'token rotate',
        checks: [
            { name: 'load-config', run: loadOrCreateConfig },
            { name: 'ask-tokens', requires: ['tokenTtlMonths', 'bot'], run: askTokens },
            { name: 'check-access', requires: ['targets', 'origin', 'ownerToken'], run: checkTargetsAccess }
        ],
        steps: [
            { name: 'update-ci-variables', run: updateCiVariables }
        ]
    });
}

module.exports = { promptHidden, askTokens, checkTargetsAccess, updateCiVariables, tokenRotate };
