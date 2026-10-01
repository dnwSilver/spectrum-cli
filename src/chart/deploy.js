const readline = require('readline');
const { logSuccess, logError, execCommand, execSilent } = require('../common/utils');
const { runCommand } = require('../cli/command-executor');
const { requireGitRepo, requireCleanWorkingTree, requireOnMainBranch, requireCurrentBranchUpToDateWithRemote, requireRemoteOrigin, requireRemoteReachable, requireSingleChart, requireHelmReleaseFiles } = require('../preflight');
const { getLatestRemoteChartVersion } = require('./metadata');
const { fetchChartVersionFromRegistry } = require('./registry');
const { getInstanceName, parseInstancesOption, updateHelmReleaseVersion, printDeployChanges, splitGitNameOnly } = require('./helmrelease');
function waitForEnter(promptText) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(promptText, () => {
            rl.close();
            resolve(true);
        });
    });
}

function chartDeploy(options = {}) {
    const instancesOption = options.instances;

    return runCommand({
        name: 'chart deploy',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'clean-working-tree', run: requireCleanWorkingTree },
            { name: 'on-main-branch', run: requireOnMainBranch },
            { name: 'branch-up-to-date', run: requireCurrentBranchUpToDateWithRemote },
            { name: 'remote-origin', run: requireRemoteOrigin },
            { name: 'remote-reachable', run: requireRemoteReachable },
            { name: 'single-chart', run: requireSingleChart },
            { name: 'helmrelease-files', run: requireHelmReleaseFiles },
            {
                name: 'filter-instances',
                run: (ctx) => {
                    const requested = parseInstancesOption(instancesOption);
                    if (requested.length === 0) {
                        return { ok: true };
                    }

                    const available = new Map();
                    for (const filePath of ctx.helmReleaseFiles || []) {
                        const instanceName = getInstanceName(filePath);
                        if (instanceName) {
                            available.set(instanceName, filePath);
                        }
                    }

                    if (available.size === 0) {
                        return {
                            ok: false,
                            reason: 'В репозитории нет файлов instances/<name>/helmrelease.yaml, флаг --instances неприменим.'
                        };
                    }

                    const unknown = requested.filter((name) => !available.has(name));
                    if (unknown.length > 0) {
                        return {
                            ok: false,
                            reason: `Неизвестные инстансы: ${unknown.join(', ')}. Доступные: ${Array.from(available.keys()).join(', ')}.`
                        };
                    }

                    return { ok: true, data: { helmReleaseFiles: requested.map((name) => available.get(name)) } };
                }
            }
        ],
        steps: [
            {
                name: 'resolve-latest-chart-version',
                run: (ctx) => {
                    const latestVersion = getLatestRemoteChartVersion(ctx.chartName);
                    if (!latestVersion) {
                        logError('❌', 'Не удалось найти удаленный тег чарта для %s.', ctx.chartName);
                        return false;
                    }
                    ctx.latestChartVersion = latestVersion;
                    logSuccess('🏷️', 'Последняя удаленная версия чарта для %s: %s.', ctx.chartName, latestVersion);
                    return true;
                }
            },
            {
                name: 'verify-chart-in-registry',
                run: async (ctx) => {
                    const result = await fetchChartVersionFromRegistry(ctx.chartName, ctx.latestChartVersion);
                    if (!result.ok) {
                        logError('❌', '%s', result.reason);
                        return false;
                    }
                    if (!result.found) {
                        logError(
                            '❌',
                            'Версия %s чарта %s отсутствует в Helm-registry. Дождитесь пайплайна "upload charts" и повторите.',
                            ctx.latestChartVersion,
                            ctx.chartName
                        );
                        return false;
                    }
                    logSuccess('📦', 'Версия %s чарта %s найдена в Helm-registry.', ctx.latestChartVersion, ctx.chartName);
                    return true;
                }
            },
            {
                name: 'update-helmrelease-files',
                run: (ctx) => {
                    const changes = (ctx.helmReleaseFiles || []).map((filePath) => updateHelmReleaseVersion(filePath, ctx.latestChartVersion));
                    ctx.deployChanges = changes;
                    ctx.updatedFiles = changes.filter((item) => item.changed).map((item) => item.filePath);
                    ctx.updatedInstances = ctx.updatedFiles.map((filePath) => getInstanceName(filePath) || filePath);

                    printDeployChanges(changes);
                    if (ctx.updatedFiles.length === 0) {
                        ctx.noUpdates = true;
                        logSuccess('✅', 'Все файлы helmrelease.yaml уже используют последнюю версию чарта.');
                        return true;
                    }

                    logSuccess('📋', 'Будут обновлены инстансы: %s (версия чарта %s).', ctx.updatedInstances.join(', '), ctx.latestChartVersion);
                    return true;
                }
            },
            {
                name: 'confirm-publish',
                run: async (ctx) => {
                    if (ctx.noUpdates) {
                        return true;
                    }
                    await waitForEnter('Готов ли ты к публикации? Нажми Enter для продолжения (Ctrl+C для отмены): ');
                    return true;
                }
            },
            {
                name: 'commit-and-push',
                run: (ctx) => {
                    if (ctx.noUpdates) {
                        return true;
                    }
                    const files = ctx.updatedFiles || [];
                    const normalizedFiles = files.map((filePath) => String(filePath || '').replace(/\\/g, '/'));
                    if (files.length === 0) {
                        logSuccess('✅', 'Файлы не были изменены.');
                        return true;
                    }

                    const stagedBeforeAdd = splitGitNameOnly(execSilent('git diff --cached --name-only'));
                    const unstagedBeforeAdd = splitGitNameOnly(execSilent('git diff --name-only'));
                    if (stagedBeforeAdd === null || unstagedBeforeAdd === null) {
                        logError('❌', 'Не удалось проверить измененные файлы перед коммитом.');
                        return false;
                    }
                    if (stagedBeforeAdd.length > 0) {
                        logError('❌', 'Обнаружены неожиданные изменения в индексе: %s', stagedBeforeAdd.join(', '));
                        return false;
                    }

                    const expectedSet = new Set(normalizedFiles);
                    const unexpectedChanges = unstagedBeforeAdd.filter((filePath) => !expectedSet.has(filePath));
                    if (unexpectedChanges.length > 0) {
                        logError('❌', 'Обнаружены неожиданные изменения файлов: %s', unexpectedChanges.join(', '));
                        return false;
                    }

                    const missingExpectedChanges = normalizedFiles.filter((filePath) => !unstagedBeforeAdd.includes(filePath));
                    if (missingExpectedChanges.length > 0) {
                        logError('❌', 'В diff отсутствуют ожидаемые обновленные файлы: %s', missingExpectedChanges.join(', '));
                        return false;
                    }

                    const quoted = normalizedFiles.map((filePath) => `"${filePath}"`).join(' ');
                    if (!execCommand(`git add ${quoted}`)) {
                        logError('❌', 'Не удалось добавить обновленные файлы helmrelease.');
                        return false;
                    }

                    const stagedAfterAdd = splitGitNameOnly(execSilent('git diff --cached --name-only'));
                    if (stagedAfterAdd === null) {
                        logError('❌', 'Не удалось проверить staged-файлы после git add.');
                        return false;
                    }
                    const unexpectedStaged = stagedAfterAdd.filter((filePath) => !expectedSet.has(filePath));
                    const missingStaged = normalizedFiles.filter((filePath) => !stagedAfterAdd.includes(filePath));
                    if (unexpectedStaged.length > 0 || missingStaged.length > 0) {
                        if (unexpectedStaged.length > 0) {
                            logError('❌', 'Обнаружены неожиданные staged-файлы: %s', unexpectedStaged.join(', '));
                        }
                        if (missingStaged.length > 0) {
                            logError('❌', 'Ожидаемые файлы не добавлены в индекс: %s', missingStaged.join(', '));
                        }
                        return false;
                    }

                    const instanceNames = (ctx.updatedInstances && ctx.updatedInstances.length > 0)
                        ? ctx.updatedInstances
                        : normalizedFiles.map((filePath) => getInstanceName(filePath) || filePath);
                    const versionPart = ctx.latestChartVersion ? ` ${ctx.latestChartVersion}` : '';
                    const commitMessage = `🚀 Деплой сервиса${versionPart} (${instanceNames.join(', ')}).`;
                    if (!execCommand(`git commit -m "${commitMessage}"`)) {
                        logError('❌', 'Не удалось создать коммит деплоя.');
                        return false;
                    }
                    if (!execCommand('git push')) {
                        logError('❌', 'Не удалось отправить коммит деплоя.');
                        return false;
                    }

                    logSuccess('🚀', 'Коммит деплоя отправлен.');
                    return true;
                }
            }
        ]
    });
}

module.exports = { chartDeploy };
