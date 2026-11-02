const fs = require('fs');
const { execSync } = require('child_process');
const { SEMVER_PATTERN } = require('../preflight');
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

function compareSemver(a, b) {
    const parse = (value) => {
        const [rawMain, rawMeta] = String(value || '').split('+', 2);
        const [rawVersion, rawPre] = rawMain.split('-', 2);
        const versionParts = rawVersion.split('.').map((part) => Number(part));
        const preParts = rawPre ? rawPre.split('.') : [];
        return { versionParts, preParts, hasPre: Boolean(rawPre), meta: rawMeta || '' };
    };
    const pa = parse(a);
    const pb = parse(b);

    for (let i = 0; i < 3; i += 1) {
        const diff = (pa.versionParts[i] || 0) - (pb.versionParts[i] || 0);
        if (diff !== 0) return diff;
    }

    if (pa.hasPre && !pb.hasPre) return -1;
    if (!pa.hasPre && pb.hasPre) return 1;
    if (!pa.hasPre && !pb.hasPre) return 0;

    const len = Math.max(pa.preParts.length, pb.preParts.length);
    for (let i = 0; i < len; i += 1) {
        const aa = pa.preParts[i];
        const bb = pb.preParts[i];
        if (aa === undefined) return -1;
        if (bb === undefined) return 1;
        const aNum = /^\d+$/.test(aa);
        const bNum = /^\d+$/.test(bb);
        if (aNum && bNum) {
            const diff = Number(aa) - Number(bb);
            if (diff !== 0) return diff;
            continue;
        }
        if (aNum && !bNum) return -1;
        if (!aNum && bNum) return 1;
        if (aa < bb) return -1;
        if (aa > bb) return 1;
    }

    return 0;
}

function getLatestRemoteChartVersion(chartName) {
    const safeChartName = String(chartName || '').trim();
    if (!safeChartName) return null;

    const prefix = `chart-${safeChartName}-`;
    let output = '';
    try {
        output = execSync(`git ls-remote --tags origin "refs/tags/${prefix}*"`, { stdio: 'pipe', encoding: 'utf8' });
    } catch (error) {
        return null;
    }

    const versions = String(output || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(/\s+/)[1] || '')
        .map((ref) => ref.replace('refs/tags/', ''))
        .filter((tag) => tag.startsWith(prefix))
        .map((tag) => tag.slice(prefix.length))
        .filter((version) => isSemver(version));

    if (versions.length === 0) {
        return null;
    }

    versions.sort(compareSemver);
    return versions[versions.length - 1];
}

module.exports = { getChartFiles, getChartName, isSemver, compareSemver, getLatestRemoteChartVersion };
