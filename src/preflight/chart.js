const fs = require('fs');
const path = require('path');
const { ok, fail, SEMVER_PATTERN, toPosixPath } = require('./result');
function requireChartChangelogVersion(chartDir) {
    const changelogPath = toPosixPath(path.join(String(chartDir || ''), 'CHANGELOG.md'));
    if (!fs.existsSync(changelogPath)) {
        return fail(`Файл "${changelogPath}" не существует. Заполните changelog чарта перед созданием тега.`);
    }

    let changelog;
    try {
        changelog = fs.readFileSync(changelogPath, 'utf8');
    } catch (error) {
        return fail(`Не удалось прочитать "${changelogPath}".`);
    }

    const firstHeading = changelog.match(/^##(?!#)[^\r\n]*$/m)?.[0];
    const version = firstHeading?.match(/^##\s+(?:\S+\s+)?\[([^\]]+)\](?:\([^)\s]*\))?(?:\s|$)/)?.[1];
    if (!version || !SEMVER_PATTERN.test(version)) {
        return fail(`Верхний раздел "${changelogPath}" должен содержать версию SemVer в заголовке "## [X.Y.Z]".`);
    }

    return ok({ chartChangelogPath: changelogPath, version });
}

function requireSingleChart() {
    const chartsDir = 'charts';
    if (!fs.existsSync(chartsDir)) {
        return fail('Не удалось найти директорию charts.');
    }

    const entries = fs.readdirSync(chartsDir, { withFileTypes: true });
    const chartFiles = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${chartsDir}/${entry.name}/Chart.yaml`)
        .filter((chartFilePath) => fs.existsSync(chartFilePath));

    if (chartFiles.length === 0) {
        return fail('Не удалось найти Chart.yaml по пути charts/<chart-name>/Chart.yaml.');
    }

    if (chartFiles.length > 1) {
        return fail(`Найдено несколько chart-файлов: ${chartFiles.join(', ')}.`);
    }

    const chartFilePath = chartFiles[0];
    const chartYaml = fs.readFileSync(chartFilePath, 'utf8');
    const nameMatch = chartYaml.match(/^\s*name:\s*([^\s#]+)\s*$/m);
    const chartName = nameMatch ? nameMatch[1] : null;
    if (!chartName) {
        return fail(`Не удалось прочитать имя чарта из ${chartFilePath}.`);
    }

    return ok({ chartFilePath, chartName });
}

module.exports = { requireChartChangelogVersion, requireSingleChart };
