#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
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

function requireRemoteOrigin() {
    const remoteUrl = execSilent('git remote get-url origin');
    if (!remoteUrl) {
        return fail('Git remote "origin" is not configured.');
    }
    return ok({ remoteOrigin: remoteUrl });
}

function requireRemoteReachable() {
    const remoteHeads = execSilent('git ls-remote --heads origin');
    if (remoteHeads === null) {
        return fail('Cannot access remote "origin".');
    }
    return ok();
}

function requireCurrentBranchUpToDateWithRemote() {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Cannot determine current branch.');
    }

    if (!execCommand('git fetch --all --prune --jobs=10')) {
        return fail('Cannot fetch remote changes.');
    }

    const upstreamBranch = execSilent('git rev-parse --abbrev-ref --symbolic-full-name "@{u}"');
    if (!upstreamBranch || !upstreamBranch.trim()) {
        return fail(`Current branch "${currentBranch}" has no upstream branch.`);
    }

    const aheadBehind = execSilent(`git rev-list --left-right --count HEAD...${upstreamBranch.trim()}`);
    if (!aheadBehind) {
        return fail(`Cannot compare current branch "${currentBranch}" with "${upstreamBranch.trim()}".`);
    }

    const parts = aheadBehind.trim().split(/\s+/);
    const behindBy = Number(parts[1] || 0);
    if (!Number.isFinite(behindBy)) {
        return fail(`Cannot parse ahead/behind info for "${upstreamBranch.trim()}".`);
    }

    if (behindBy > 0) {
        return fail(`Remote branch has new commits (${behindBy}). Run "git pull" and retry.`);
    }

    return ok({ currentBranch, upstreamBranch: upstreamBranch.trim() });
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

function requireOnReleaseBranch() {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Cannot determine current branch.');
    }
    if (!currentBranch.startsWith('release/')) {
        return fail(`Current branch is "${currentBranch}", expected "release/*".`);
    }
    return ok({ currentBranch });
}

function requireReleaseBranchMissing(branchName) {
    const localBranch = execSilent(`git branch --list "${branchName}"`);
    if (localBranch && localBranch.trim()) {
        return fail(`Branch "${branchName}" already exists locally.`);
    }
    const remoteBranch = execSilent(`git ls-remote --heads origin "refs/heads/${branchName}"`);
    if (remoteBranch && remoteBranch.trim()) {
        return fail(`Branch "${branchName}" already exists on origin.`);
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

function findValuesYamlFiles(baseDir = 'charts') {
    if (!fs.existsSync(baseDir)) {
        return [];
    }

    const stack = [baseDir];
    const files = [];

    while (stack.length > 0) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (error) {
            return [];
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }

            if (entry.isFile() && entry.name === 'values.yaml') {
                files.push(fullPath);
            }
        }
    }

    return files.sort();
}

function findHelmReleaseFiles(baseDir = '.') {
    if (!fs.existsSync(baseDir)) {
        return [];
    }

    const skipDirs = new Set(['.git', 'node_modules']);
    const stack = [baseDir];
    const files = [];

    while (stack.length > 0) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (error) {
            return [];
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!skipDirs.has(entry.name)) {
                    stack.push(fullPath);
                }
                continue;
            }

            if (entry.isFile() && entry.name.toLowerCase() === 'helmrelease.yaml') {
                files.push(fullPath);
            }
        }
    }

    return files.sort();
}

function requireHelmReleaseFiles() {
    const helmReleaseFiles = findHelmReleaseFiles('.');
    if (helmReleaseFiles.length === 0) {
        return fail('Cannot find helmrelease.yaml files in the repository.');
    }
    return ok({ helmReleaseFiles });
}

function requireSingleValuesYaml() {
    const valuesFiles = findValuesYamlFiles('charts');
    if (valuesFiles.length === 0) {
        return fail('Cannot find values.yaml under charts/**/values.yaml.');
    }
    if (valuesFiles.length > 1) {
        return fail(`Found multiple values.yaml files: ${valuesFiles.join(', ')}.`);
    }
    return ok({ valuesYamlPath: valuesFiles[0] });
}

function extractYamlList(content, sectionName) {
    const lines = String(content || '').split('\n');
    let inIngress = false;
    let inPaths = false;
    let inSection = false;
    let ingressIndent = 0;
    let pathsIndent = 0;
    let sectionIndent = 0;
    const values = [];

    for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        const indent = line.match(/^\s*/)[0].length;
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        if (/^ingress:\s*(#.*)?$/.test(trimmed)) {
            inIngress = true;
            inPaths = false;
            inSection = false;
            ingressIndent = indent;
            continue;
        }

        if (inIngress && indent <= ingressIndent && !/^ingress:\s*(#.*)?$/.test(trimmed)) {
            inIngress = false;
            inPaths = false;
            inSection = false;
        }

        if (!inIngress) {
            continue;
        }

        if (/^paths:\s*(#.*)?$/.test(trimmed)) {
            inPaths = true;
            inSection = false;
            pathsIndent = indent;
            continue;
        }

        if (inPaths && indent <= pathsIndent && !/^paths:\s*(#.*)?$/.test(trimmed)) {
            inPaths = false;
            inSection = false;
        }

        if (!inPaths) {
            continue;
        }

        const sectionRegex = new RegExp(`^${sectionName}:\\s*(#.*)?$`);
        if (sectionRegex.test(trimmed)) {
            inSection = true;
            sectionIndent = indent;
            continue;
        }

        if (inSection && indent <= sectionIndent && !sectionRegex.test(trimmed)) {
            inSection = false;
        }

        if (!inSection) {
            continue;
        }

        const itemMatch = line.match(/^\s*-\s+(.+?)(?:\s+#.*)?$/);
        if (itemMatch) {
            values.push(itemMatch[1].trim());
        }
    }

    return values;
}

function requireIngressPathSections(valuesYamlPath) {
    if (!valuesYamlPath || !fs.existsSync(valuesYamlPath)) {
        return fail(`Required file "${valuesYamlPath}" does not exist.`);
    }

    let content = '';
    try {
        content = fs.readFileSync(valuesYamlPath, 'utf8');
    } catch (error) {
        return fail(`Cannot read "${valuesYamlPath}".`);
    }

    const api = extractYamlList(content, 'api');
    const pages = extractYamlList(content, 'pages');
    const assets = extractYamlList(content, 'assets');

    if (api.length === 0) {
        return fail(`Missing or empty ingress.paths.api in "${valuesYamlPath}".`);
    }
    if (pages.length === 0) {
        return fail(`Missing or empty ingress.paths.pages in "${valuesYamlPath}".`);
    }
    if (assets.length === 0) {
        return fail(`Missing or empty ingress.paths.assets in "${valuesYamlPath}".`);
    }

    return ok({
        valuesIngressPaths: { api, pages, assets }
    });
}

function requireSourcePathDirectory(sourcePath) {
    if (!sourcePath || typeof sourcePath !== 'string') {
        return fail('Source path is required.');
    }
    const resolved = path.resolve(sourcePath);
    if (!fs.existsSync(resolved)) {
        return fail(`Source path does not exist: "${sourcePath}".`);
    }

    let stat;
    try {
        stat = fs.statSync(resolved);
    } catch (error) {
        return fail(`Cannot access source path: "${sourcePath}".`);
    }
    if (!stat.isDirectory()) {
        return fail(`Source path is not a directory: "${sourcePath}".`);
    }

    return ok({ sourcePath: resolved });
}

function hasNextConfig(sourcePath) {
    const files = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'];
    return files.some((fileName) => fs.existsSync(path.join(sourcePath, fileName)));
}

function requireNextProject(sourcePath) {
    if (!sourcePath) {
        return fail('Source path is required.');
    }

    const pkgPath = path.join(sourcePath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        return fail(`Cannot find package.json in "${sourcePath}".`);
    }

    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (error) {
        return fail(`Cannot parse package.json in "${sourcePath}".`);
    }

    const dependencies = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
    const hasNextDependency = typeof dependencies.next === 'string';
    const nextConfigExists = hasNextConfig(sourcePath);

    if (!hasNextDependency && !nextConfigExists) {
        return fail(`"${sourcePath}" does not look like a Next.js project.`);
    }

    return ok({
        sourcePackageJsonPath: pkgPath,
        sourcePackageManager: fs.existsSync(path.join(sourcePath, 'yarn.lock'))
            ? 'yarn'
            : fs.existsSync(path.join(sourcePath, 'bun.lockb'))
                ? 'bun'
                : 'npm',
        sourceHasLockfile: Boolean(
            fs.existsSync(path.join(sourcePath, 'package-lock.json')) ||
            fs.existsSync(path.join(sourcePath, 'yarn.lock')) ||
            fs.existsSync(path.join(sourcePath, 'bun.lockb'))
        )
    });
}

function requireBuildCommandSupport(sourcePath) {
    if (!sourcePath) {
        return fail('Source path is required.');
    }

    const pkgPath = path.join(sourcePath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        return fail(`Cannot find package.json in "${sourcePath}".`);
    }

    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (error) {
        return fail(`Cannot parse package.json in "${sourcePath}".`);
    }

    if (!pkg.scripts || typeof pkg.scripts.build !== 'string') {
        return fail(`Missing build script in "${pkgPath}".`);
    }

    return ok({ sourceBuildScript: pkg.scripts.build });
}

module.exports = {
    SEMVER_PATTERN,
    getPrettierRunner,
    requireGitRepo,
    requireCleanWorkingTree,
    requireMainAndDevBranches,
    requireCurrentBranch,
    requireOnMainBranch,
    requireRemoteOrigin,
    requireRemoteReachable,
    requireCurrentBranchUpToDateWithRemote,
    requireFileExists,
    requirePackageVersion,
    requireTagMissing,
    requireOnReleaseBranch,
    requireReleaseBranchMissing,
    requirePrettierAvailable,
    requireChangelogFormatted,
    requireSingleChart,
    findValuesYamlFiles,
    findHelmReleaseFiles,
    extractYamlList,
    requireSingleValuesYaml,
    requireHelmReleaseFiles,
    requireIngressPathSections,
    requireSourcePathDirectory,
    requireNextProject,
    requireBuildCommandSupport
};
