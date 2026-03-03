#!/usr/bin/env node
const fs = require('fs');
const { execSilent, execCommand, getCurrentBranch, getMainBranch, getDevelopBranch, getVersion } = require('./utils');

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function ok(data) {
    return { ok: true, data };
}

function fail(reason) {
    return { ok: false, reason };
}

function getPrettierRunner() {
    const npxVersion = execSilent('npx --yes prettier --version');
    if (npxVersion) return 'npx --yes prettier';
    const directVersion = execSilent('prettier --version');
    if (directVersion) return 'prettier';
    return null;
}

function requireGitRepo() {
    if (!execCommand('git rev-parse --is-inside-work-tree')) {
        return fail('Not inside a git repository.');
    }
    return ok();
}

function requireCleanWorkingTree() {
    const status = execSilent('git status --porcelain');
    if (status === null) {
        return fail('Cannot read git working tree status.');
    }
    if (status.trim() !== '') {
        return fail('Working tree is not clean.');
    }
    return ok();
}

function requireMainAndDevBranches() {
    const branches = execSilent('git branch -r');
    if (!branches) {
        return fail('Cannot read remote branches.');
    }

    const mainBranch = getMainBranch();
    const devBranch = getDevelopBranch();
    const hasMain = branches.includes(`origin/${mainBranch}`);
    const hasDev = branches.includes(`origin/${devBranch}`);

    if (!hasMain || !hasDev) {
        return fail(`Required remote branches are missing (origin/${mainBranch}, origin/${devBranch}).`);
    }

    return ok({ mainBranch, devBranch });
}

function requireCurrentBranch(expectedBranch) {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Cannot determine current branch.');
    }
    if (currentBranch !== expectedBranch) {
        return fail(`Current branch is "${currentBranch}", expected "${expectedBranch}".`);
    }
    return ok({ currentBranch });
}

function requireOnMainBranch() {
    const mainBranch = getMainBranch();
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Cannot determine current branch.');
    }
    if (currentBranch !== mainBranch) {
        return fail(`Current branch is "${currentBranch}", expected "${mainBranch}".`);
    }
    return ok({ mainBranch, currentBranch });
}

function requireFileExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return fail(`Required file "${filePath}" does not exist.`);
    }
    return ok();
}

function requirePackageVersion() {
    const version = getVersion();
    if (!version) {
        return fail('Cannot read version from package.json.');
    }
    if (!SEMVER_PATTERN.test(version)) {
        return fail(`Version "${version}" is not valid semver.`);
    }
    return ok({ version });
}

function requireTagMissing(tagName) {
    const localTag = execSilent(`git tag -l "${tagName}"`);
    if (localTag && localTag.trim()) {
        return fail(`Tag "${tagName}" already exists locally.`);
    }

    const remoteTag = execSilent(`git ls-remote --tags origin "refs/tags/${tagName}"`);
    if (remoteTag && remoteTag.trim()) {
        return fail(`Tag "${tagName}" already exists on origin.`);
    }

    return ok();
}

function requirePrettierAvailable() {
    const runner = getPrettierRunner();
    if (!runner) {
        return fail('Prettier is not available.');
    }
    return ok({ prettierRunner: runner });
}

function requireChangelogFormatted() {
    const runner = getPrettierRunner();
    if (!runner) {
        return fail('Prettier is not available.');
    }
    if (!execCommand(`${runner} --check CHANGELOG.md`)) {
        return fail('CHANGELOG.md failed Prettier check.');
    }
    return ok({ prettierRunner: runner });
}

function requireSingleChart() {
    const chartsDir = 'charts';
    if (!fs.existsSync(chartsDir)) {
        return fail('Cannot find charts directory.');
    }

    const entries = fs.readdirSync(chartsDir, { withFileTypes: true });
    const chartFiles = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${chartsDir}/${entry.name}/Chart.yaml`)
        .filter((chartFilePath) => fs.existsSync(chartFilePath));

    if (chartFiles.length === 0) {
        return fail('Cannot find Chart.yaml in charts/<chart-name>/Chart.yaml.');
    }

    if (chartFiles.length > 1) {
        return fail(`Found multiple charts: ${chartFiles.join(', ')}.`);
    }

    const chartFilePath = chartFiles[0];
    const chartYaml = fs.readFileSync(chartFilePath, 'utf8');
    const nameMatch = chartYaml.match(/^\s*name:\s*([^\s#]+)\s*$/m);
    const chartName = nameMatch ? nameMatch[1] : null;
    if (!chartName) {
        return fail(`Cannot read chart name from ${chartFilePath}.`);
    }

    return ok({ chartFilePath, chartName });
}

module.exports = {
    SEMVER_PATTERN,
    getPrettierRunner,
    requireGitRepo,
    requireCleanWorkingTree,
    requireMainAndDevBranches,
    requireCurrentBranch,
    requireOnMainBranch,
    requireFileExists,
    requirePackageVersion,
    requireTagMissing,
    requirePrettierAvailable,
    requireChangelogFormatted,
    requireSingleChart
};
