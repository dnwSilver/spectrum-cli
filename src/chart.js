#!/usr/bin/env node
const fs = require('fs');
const { logSuccess, logError, execSilent, execCommand, getCurrentBranch, getMainBranch } = require('./utils');

const CHARTS_DIR = 'charts';
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

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
    const mainBranch = getMainBranch();
    const currentBranch = getCurrentBranch();
    if (currentBranch !== mainBranch) {
        logError('❌', 'Current branch is "%s". Switch to "%s" first.', currentBranch || 'unknown', mainBranch);
        return false;
    }

    if (!isSemver(version)) {
        logError('❌', 'Version "%s" is not a valid semver.', version);
        return false;
    }

    const chartFiles = getChartFiles();
    if (chartFiles.length === 0) {
        logError('❌', 'Cannot find Chart.yaml in %s/<chart-name>/Chart.yaml.', CHARTS_DIR);
        return false;
    }

    if (chartFiles.length > 1) {
        logError('❌', 'Found multiple charts: %s. Keep only one chart directory.', chartFiles.join(', '));
        return false;
    }

    const chartFilePath = chartFiles[0];
    const chartName = getChartName(chartFilePath);
    if (!chartName) {
        logError('❌', 'Cannot read chart name from %s.', chartFilePath);
        return false;
    }

    const tagName = `chart-${chartName}-${version}`;
    const existingTag = execSilent(`git tag -l "${tagName}"`);
    if (existingTag) {
        logError('❌', 'Tag %s already exists.', tagName);
        return false;
    }

    if (!execCommand(`git tag "${tagName}"`)) {
        logError('❌', 'Cannot create tag %s.', tagName);
        return false;
    }

    logSuccess('🔖', 'Created tag %s.', tagName);

    if (!execCommand(`git push origin "${tagName}"`)) {
        logError('❌', 'Cannot push tag %s to origin.', tagName);
        return false;
    }

    logSuccess('🚀', 'Pushed tag %s to origin.', tagName);
    return true;
}

module.exports = {
    chartCreateTag,
    getChartName,
    getChartFiles,
    isSemver
};
