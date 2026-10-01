#!/usr/bin/env node
const { logError, logSuccess } = require('../common/utils');
const { AsyncLocalStorage } = require('async_hooks');

const commandContext = new AsyncLocalStorage();

const PREFLIGHT_DESCRIPTIONS = Object.freeze({
    'git-repo': 'текущий каталог находится в Git-репозитории',
    'clean-working-tree': 'рабочее дерево Git чистое',
    'branch-up-to-date': 'текущая ветка не отстаёт от upstream',
    'main-and-dev-branches': 'найдены production- и integration-ветки',
    'on-main-branch': 'выбрана production-ветка main/master',
    'on-dev-branch': 'выбрана integration-ветка dev/develop',
    'dev-contains-main': 'integration-ветка содержит актуальную production-ветку',
    'stable-version': 'найден последний стабильный тег production',
    'changelog-exists': 'найден CHANGELOG.md',
    'release-state': 'состояние опубликованных и открытых релизов согласовано',
    'changelog-prettier-check': 'CHANGELOG.md проходит проверку Prettier',
    'changelog-fragments': 'проверены changelog fragments и их формат',
    'detect-bump-type': 'определена целевая версия и проверена её доступность',
    'changelog-release-version': 'прочитана стабильная версия из CHANGELOG.md',
    'stable-tag-at-head': 'стабильный тег указывает на текущий commit',
    'prettier-available': 'Prettier доступен',
    'prepare-fragment': 'проверены ветка, ID задачи, Git identity и раздел fragment',
    'single-chart': 'найден ровно один Chart.yaml с именем чарта',
    'chart-changelog-version': 'версия прочитана из верхнего заголовка changelog чарта',
    'tag-missing': 'целевой тег отсутствует локально и на origin',
    'version-not-downgrade': 'версия сопоставлена с последним chart-тегом на origin',
    'registry-version-missing': 'целевая версия чарта отсутствует в Helm-registry',
    'remote-origin': 'настроен remote origin',
    'remote-reachable': 'remote origin доступен',
    'helmrelease-files': 'найдены файлы helmrelease.yaml',
    'filter-instances': 'параметр --instances проверен (или не задан)',
    'single-values-yaml': 'найден единственный values.yaml чарта',
    'values-ingress-sections': 'найдены секции ingress paths',
    'source-path-directory': 'исходный каталог существует',
    'next-project': 'исходники принадлежат Next.js-проекту',
    'build-command-support': 'доступна команда сборки проекта',
    'load-config': 'конфигурация ротации токена загружена и проверена',
    'ask-tokens': 'необходимые токены получены без вывода их значений',
    'check-access': 'проверен доступ к целевым группам и проектам GitLab'
});

function describePreflight(checkName, context) {
    const description = PREFLIGHT_DESCRIPTIONS[checkName] || checkName;
    const details = {
        'branch-up-to-date': context.currentBranch,
        'stable-version': context.stableVersion,
        'changelog-release-version': context.version,
        'detect-bump-type': context.newVersion,
        'single-chart': context.chartName,
        'chart-changelog-version': context.version,
        'changelog-fragments': Array.isArray(context.changelogFragments)
            ? `${context.changelogFragments.length} файл(ов)` : null,
        'helmrelease-files': Array.isArray(context.helmReleaseFiles)
            ? `${context.helmReleaseFiles.length} файл(ов)` : null
    }[checkName];
    return details ? `${description}: ${details}` : description;
}

function withCommandOptions(options, action) {
    return commandContext.run({ dry: Boolean(options?.dry), silence: Boolean(options?.silence) }, action);
}

function withDryRun(dry, action) {
    return withCommandOptions({ dry }, action);
}

function isDryRun() {
    return Boolean(commandContext.getStore()?.dry);
}

function reportDryRun(_name) {
    logSuccess('✅', 'Все предпроверки пройдены, проблем нет. Действия не выполнялись.');
}

function reportPreflight(_commandName, checkName, description = PREFLIGHT_DESCRIPTIONS[checkName] || checkName) {
    if (!commandContext.getStore()?.silence) {
        logSuccess('🔎', 'Проверено (%s): %s.', checkName, description);
    }
}

function reportNoPreflights(_name) {
    logSuccess('🔎', 'Предпроверок нет.');
}

function normalizeCheckResult(result, fallbackReason) {
    if (typeof result === 'boolean') {
        return { ok: result, reason: result ? null : fallbackReason };
    }

    if (typeof result === 'string') {
        return { ok: false, reason: result };
    }

    if (result && typeof result === 'object') {
        return {
            ok: Boolean(result.ok),
            reason: result.reason || fallbackReason,
            data: result.data
        };
    }

    return { ok: false, reason: fallbackReason };
}

async function runCommand(spec) {
    const {
        name,
        checks = [],
        steps = [],
        context = {}
    } = spec || {};

    if (!name) {
        logError('❌', 'Требуется имя команды.');
        return false;
    }

    let failedPreflights = 0;
    const results = new Map();
    for (const check of checks) {
        const checkName = check.name || 'unknown-check';
        const failedDependencies = (check.dependsOn || []).filter((dependency) => results.get(dependency) !== true);
        const missingInputs = (check.requires || []).filter((key) => context[key] === undefined || context[key] === null);
        if (failedDependencies.length || missingInputs.length) {
            const reason = [
                failedDependencies.length ? `не пройдены проверки: ${failedDependencies.join(', ')}` : null,
                missingInputs.length ? `отсутствуют данные: ${missingInputs.join(', ')}` : null
            ].filter(Boolean).join('; ');
            logError('❌', 'Предпроверка не выполнена (%s): %s', checkName, reason);
            results.set(checkName, false);
            failedPreflights += 1;
            continue;
        }

        let checkResult;
        try {
            checkResult = normalizeCheckResult(
                await check.run(context),
                `Проверка не пройдена: ${checkName}`
            );
        } catch (error) {
            checkResult = { ok: false, reason: error?.message || String(error) };
        }

        if (!checkResult.ok) {
            logError('❌', 'Предпроверка не пройдена (%s): %s', checkName, checkResult.reason || 'неизвестная причина');
            results.set(checkName, false);
            failedPreflights += 1;
            continue;
        }

        results.set(checkName, true);
        if (checkResult.data && typeof checkResult.data === 'object') {
            Object.assign(context, checkResult.data);
        }
        reportPreflight(name, checkName, check.description || describePreflight(checkName, context));
    }

    if (failedPreflights > 0) return false;

    if (isDryRun()) {
        reportDryRun(name);
        return true;
    }

    for (const step of steps) {
        const stepName = step.name || 'unknown-step';
        const ok = await step.run(context);
        if (!ok) {
            logError('❌', 'Шаг не выполнен: %s', stepName);
            return false;
        }
    }

    logSuccess('✅', 'Выполнено.');
    return true;
}

module.exports = { runCommand, withCommandOptions, withDryRun, isDryRun, reportDryRun, reportPreflight, reportNoPreflights };
