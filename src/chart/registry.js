const { logSuccess, logError, getRemoteUrl } = require('../common/utils');
const { parseGitlabUrl } = require('../integrations/gitlab-url');
const HELM_REGISTRY_CHANNEL = 'stable';
const REGISTRY_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const REGISTRY_WAIT_INTERVAL_MS = 15 * 1000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGitlabProject() {
    const baseUrl = getRemoteUrl();
    if (!baseUrl) {
        return null;
    }
    try {
        return parseGitlabUrl(baseUrl);
    } catch (error) {
        return null;
    }
}

function helmIndexHasChartVersion(indexYamlContent, chartName, version) {
    const escapedChartName = String(chartName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const chartHeadingPattern = new RegExp(`^${escapedChartName}:\\s*(#.*)?$`);
    const lines = String(indexYamlContent || '').split('\n');
    let inEntries = false;
    let inChart = false;
    let entriesIndent = 0;
    let chartIndent = 0;

    for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const indent = line.match(/^\s*/)[0].length;

        if (/^entries:\s*(#.*)?$/.test(trimmed) && indent === 0) {
            inEntries = true;
            inChart = false;
            entriesIndent = indent;
            continue;
        }

        if (inEntries && indent <= entriesIndent) {
            inEntries = false;
            inChart = false;
        }

        if (!inEntries) {
            continue;
        }

        if (chartHeadingPattern.test(trimmed)) {
            inChart = true;
            chartIndent = indent;
            continue;
        }

        if (inChart && indent <= chartIndent) {
            inChart = false;
        }

        if (!inChart) {
            continue;
        }

        const versionMatch = trimmed.match(/^-?\s*version:\s*["']?([^"'\s#]+)["']?\s*(#.*)?$/);
        if (versionMatch && versionMatch[1] === String(version)) {
            return true;
        }
    }

    return false;
}

async function fetchChartVersionFromRegistry(chartName, version) {
    const project = getGitlabProject();
    if (!project) {
        return { ok: false, reason: 'Не удалось определить GitLab-проект из remote "origin".' };
    }

    const accessToken = process.env.GITLAB_PRIVATE_TOKEN;
    if (!accessToken) {
        return {
            ok: false,
            reason: 'Не задана переменная окружения GITLAB_PRIVATE_TOKEN. Она нужна для проверки публикации чарта в Helm-registry.'
        };
    }

    const indexUrl = `${project.origin}/api/v4/projects/${project.encodedPath}/packages/helm/${HELM_REGISTRY_CHANNEL}/index.yaml`;
    let response;
    try {
        response = await fetch(indexUrl, { headers: { 'PRIVATE-TOKEN': accessToken } });
    } catch (error) {
        return { ok: false, reason: `Не удалось запросить Helm-registry (${indexUrl}): ${error.message}.` };
    }

    if (!response.ok) {
        return { ok: false, reason: `Helm-registry вернул HTTP ${response.status} (${indexUrl}).` };
    }

    const indexYaml = await response.text();
    return {
        ok: true,
        found: helmIndexHasChartVersion(indexYaml, chartName, version),
        indexUrl
    };
}

async function waitForChartInRegistry(chartName, version, options = {}) {
    const timeoutMs = options.timeoutMs === undefined ? REGISTRY_WAIT_TIMEOUT_MS : options.timeoutMs;
    const intervalMs = options.intervalMs === undefined ? REGISTRY_WAIT_INTERVAL_MS : options.intervalMs;
    const sleepFn = options.sleep || sleep;
    const deadline = Date.now() + timeoutMs;

    while (true) {
        const result = await fetchChartVersionFromRegistry(chartName, version);
        if (!result.ok) {
            logError('❌', '%s', result.reason);
            return false;
        }
        if (result.found) {
            logSuccess('📦', 'Версия %s чарта %s опубликована в Helm-registry.', version, chartName);
            return true;
        }
        if (Date.now() >= deadline) {
            logError('❌', 'Версия %s чарта %s не появилась в Helm-registry за отведенное время.', version, chartName);
            return false;
        }
        logSuccess('⏳', 'Версия %s чарта %s еще не опубликована, продолжаю ожидание...', version, chartName);
        await sleepFn(intervalMs);
    }
}

module.exports = { helmIndexHasChartVersion, fetchChartVersionFromRegistry, waitForChartInRegistry };
