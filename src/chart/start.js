const path = require('path');
const { logSuccess, logError, execCommand } = require('../common/utils');
const { runCommand } = require('../cli/command-executor');
const { requireGitRepo, requireCleanWorkingTree, requireOnMainBranch, requireCurrentBranchUpToDateWithRemote, requireSingleChart, requireTagMissing, requireChartChangelogVersion } = require('../preflight');
const { getLatestRemoteChartVersion, compareSemver } = require('./metadata');
const { fetchChartVersionFromRegistry, waitForChartInRegistry } = require('./registry');
function chartStart(options = {}) {
    const force = Boolean(options.force);
    const wait = options.wait !== false;

    return runCommand({
        name: 'chart start',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'clean-working-tree', run: requireCleanWorkingTree },
            { name: 'on-main-branch', run: requireOnMainBranch },
            { name: 'branch-up-to-date', run: requireCurrentBranchUpToDateWithRemote },
            { name: 'single-chart', run: requireSingleChart },
            {
                name: 'chart-changelog-version',
                requires: ['chartFilePath'],
                run: (ctx) => requireChartChangelogVersion(path.dirname(ctx.chartFilePath))
            },
            {
                name: 'tag-missing',
                requires: ['chartName', 'version'],
                run: (ctx) => requireTagMissing(`chart-${ctx.chartName}-${ctx.version}`)
            },
            {
                name: 'version-not-downgrade',
                requires: ['chartName', 'version'],
                run: (ctx) => {
                    const latestVersion = getLatestRemoteChartVersion(ctx.chartName);
                    if (!latestVersion) {
                        return { ok: true };
                    }
                    if (compareSemver(ctx.version, latestVersion) > 0) {
                        return { ok: true, data: { latestChartVersion: latestVersion } };
                    }
                    if (force) {
                        logError('⚠️', 'Версия %s не больше последней версии тега %s. Продолжаю из-за --force.', ctx.version, latestVersion);
                        return { ok: true, data: { latestChartVersion: latestVersion } };
                    }
                    return {
                        ok: false,
                        reason: `Версия "${ctx.version}" не больше последней версии тега "${latestVersion}" на origin. Для сознательного отката используйте --force.`
                    };
                }
            },
            {
                name: 'registry-version-missing',
                requires: ['chartName', 'version'],
                run: async (ctx) => {
                    const result = await fetchChartVersionFromRegistry(ctx.chartName, ctx.version);
                    if (!result.ok) return { ok: false, reason: result.reason };
                    if (result.found) {
                        return { ok: false, reason: `Версия ${ctx.version} чарта ${ctx.chartName} уже опубликована в Helm-registry.` };
                    }
                    return { ok: true };
                }
            }
        ],
        steps: [
            {
                name: 'create-tag',
                run: (ctx) => {
                    const tagName = `chart-${ctx.chartName}-${ctx.version}`;
                    if (!execCommand(`git tag "${tagName}"`)) {
                        logError('❌', 'Не удалось создать тег %s.', tagName);
                        return false;
                    }
                    logSuccess('🔖', 'Создан тег %s.', tagName);
                    return true;
                }
            },
            {
                name: 'push-tag',
                run: (ctx) => {
                    const tagName = `chart-${ctx.chartName}-${ctx.version}`;
                    if (!execCommand(`git push origin "${tagName}"`)) {
                        logError('❌', 'Не удалось отправить тег %s в origin.', tagName);
                        return false;
                    }
                    logSuccess('🚀', 'Тег %s отправлен в origin.', tagName);
                    return true;
                }
            },
            ...(wait
                ? [{
                    name: 'wait-for-registry',
                    run: (ctx) => waitForChartInRegistry(ctx.chartName, ctx.version)
                }]
                : [])
        ]
    });
}

module.exports = { chartStart };
