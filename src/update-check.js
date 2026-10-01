const childProcess = require('child_process');
const { name, version: currentVersion } = require('../package.json');
const { compareVersions } = require('./version');
const { isDryRun, reportDryRun, reportNoPreflights } = require('./command-executor');

const UPDATE_CHECK_TIMEOUT_MS = 200;

async function checkForUpdates() {
    const controller = new AbortController();
    let timer;
    try {
        const timeout = new Promise((resolve) => {
            timer = setTimeout(() => {
                controller.abort();
                resolve(null);
            }, UPDATE_CHECK_TIMEOUT_MS);
        });
        const request = (async () => {
            const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
                signal: controller.signal,
                headers: { accept: 'application/json' }
            });
            if (!response.ok) return null;
            return (await response.json()).version;
        })();
        const latestVersion = await Promise.race([request, timeout]);
        if (compareVersions(latestVersion, currentVersion) > 0) {
            console.log(`⚠️ Доступна новая версия Spectrum CLI: сейчас ${currentVersion}, доступна ${latestVersion}.\nОбновить: spectrum upgrade`);
        }
    } catch {
        // Network and registry errors must never block a command.
    } finally {
        clearTimeout(timer);
    }
}

function upgrade() {
    reportNoPreflights('upgrade');
    if (isDryRun()) {
        reportDryRun('upgrade');
        return true;
    }
    const result = childProcess.spawnSync('npm', ['install', '-g', name], {
        stdio: 'inherit',
        shell: process.platform === 'win32'
    });
    if (result.error) throw result.error;
    return result.status === 0;
}

module.exports = { checkForUpdates, upgrade, UPDATE_CHECK_TIMEOUT_MS };
