#!/usr/bin/env node
const fs = require('fs');
const { logSuccess, logError, execCommand } = require('./utils');
const { runCommand } = require('./command-executor');
const { requireGitRepo, requireCleanWorkingTree, requireOnMainBranch, requireSingleChart, requireTagMissing, SEMVER_PATTERN } = require('./preflight');

const CHARTS_DIR = 'charts';

function getChartFiles() {
    try {
        if (!fs.existsSync(CHARTS_DIR)) {
            return [];
        }

        const entries = fs.readdirSync(CHARTS_DIR, { withFileTypes: true });
        const chartFiles = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => `${CHARTS_DIR}/${entry.name}/Chart.yaml`)
            .filter((chartFilePath) => fs.existsSync(chartFilePath));

        return chartFiles;
    } catch (error) {
        return [];
    }
}

function getChartName(chartFilePath) {
    try {
        if (!chartFilePath || !fs.existsSync(chartFilePath)) {
            return null;
        }

        const chartYaml = fs.readFileSync(chartFilePath, 'utf8');
        const nameMatch = chartYaml.match(/^\s*name:\s*([^\s#]+)\s*$/m);
        return nameMatch ? nameMatch[1] : null;
    } catch (error) {
        return null;
    }
}

function isSemver(version) {
    return SEMVER_PATTERN.test(version);
}

function chartCreateTag(version) {
    return runCommand({
        name: 'chart create',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'clean-working-tree', run: requireCleanWorkingTree },
            { name: 'on-main-branch', run: requireOnMainBranch },
            {
                name: 'valid-semver',
                run: () => {
                    if (!isSemver(version)) {
                        return { ok: false, reason: `Version "${version}" is not a valid semver.` };
                    }
                    return { ok: true, data: { version } };
                }
            },
            { name: 'single-chart', run: requireSingleChart },
            {
                name: 'tag-missing',
                run: (ctx) => requireTagMissing(`chart-${ctx.chartName}-${ctx.version}`)
            }
        ],
        steps: [
            {
                name: 'create-tag',
                run: (ctx) => {
                    const tagName = `chart-${ctx.chartName}-${ctx.version}`;
                    if (!execCommand(`git tag "${tagName}"`)) {
                        logError('❌', 'Cannot create tag %s.', tagName);
                        return false;
                    }
                    logSuccess('🔖', 'Created tag %s.', tagName);
                    return true;
                }
            },
            {
                name: 'push-tag',
                run: (ctx) => {
                    const tagName = `chart-${ctx.chartName}-${ctx.version}`;
                    if (!execCommand(`git push origin "${tagName}"`)) {
                        logError('❌', 'Cannot push tag %s to origin.', tagName);
                        return false;
                    }
                    logSuccess('🚀', 'Pushed tag %s to origin.', tagName);
                    return true;
                }
            }
        ]
    });
}

module.exports = {
    chartCreateTag,
    getChartName,
    getChartFiles,
    isSemver
};
