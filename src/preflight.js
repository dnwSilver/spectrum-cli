#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSilent, execCommand, getCurrentBranch, getMainBranch, getDevelopBranch, getVersion } = require('./utils');
const {
    CHANGELOG_DIR,
    FRAGMENT_TYPES,
    getFragmentType
} = require('./changelog-config');

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const STABLE_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const YOUTRACK_TASK_PATTERN = /^[A-Z]+-[0-9]+$/;

function ok(data) {
    return { ok: true, data };
}

function fail(reason) {
    return { ok: false, reason };
}

function toPosixPath(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
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
        return fail('Текущая директория не является git-репозиторием.');
    }
    return ok();
}

function requireCleanWorkingTree() {
    const status = execSilent('git status --porcelain');
    if (status === null) {
        return fail('Не удалось получить состояние рабочего дерева git.');
    }
    if (status.trim() !== '') {
        return fail('Рабочее дерево не чистое.');
    }
    return ok();
}

function requireMainAndDevBranches() {
    const branches = execSilent('git branch -r');
    if (!branches) {
        return fail('Не удалось получить список удаленных веток.');
    }

    const mainBranch = getMainBranch();
    const devBranch = getDevelopBranch();
    const hasMain = branches.includes(`origin/${mainBranch}`);
    const hasDev = branches.includes(`origin/${devBranch}`);

    if (!hasMain || !hasDev) {
        return fail(`Отсутствуют обязательные удаленные ветки (origin/${mainBranch}, origin/${devBranch}).`);
    }

    return ok({ mainBranch, devBranch });
}

function requireCurrentBranch(expectedBranch) {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Не удалось определить текущую ветку.');
    }
    if (currentBranch !== expectedBranch) {
        return fail(`Текущая ветка "${currentBranch}", ожидалась "${expectedBranch}".`);
    }
    return ok({ currentBranch });
}

function requireOnDevBranch() {
    const devBranch = getDevelopBranch();
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Не удалось определить текущую ветку.');
    }
    if (currentBranch !== devBranch) {
        return fail(`Текущая ветка "${currentBranch}", ожидалась "${devBranch}".`);
    }
    return ok({ devBranch, currentBranch });
}


function requireOnMainBranch() {
    const mainBranch = getMainBranch();
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Не удалось определить текущую ветку.');
    }
    if (currentBranch !== mainBranch) {
        return fail(`Текущая ветка "${currentBranch}", ожидалась "${mainBranch}".`);
    }
    return ok({ mainBranch, currentBranch });
}

function requireRemoteOrigin() {
    const remoteUrl = execSilent('git remote get-url origin');
    if (!remoteUrl) {
        return fail('Удаленный репозиторий "origin" не настроен.');
    }
    return ok({ remoteOrigin: remoteUrl });
}

function requireRemoteReachable() {
    const remoteHeads = execSilent('git ls-remote --heads origin');
    if (remoteHeads === null) {
        return fail('Не удалось получить доступ к удаленному репозиторию "origin".');
    }
    return ok();
}

function requireCurrentBranchUpToDateWithRemote() {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Не удалось определить текущую ветку.');
    }

    if (!execCommand('git fetch --all --prune --jobs=10')) {
        return fail('Не удалось получить изменения с удаленного репозитория.');
    }

    const upstreamBranch = execSilent('git rev-parse --abbrev-ref --symbolic-full-name "@{u}"');
    if (!upstreamBranch || !upstreamBranch.trim()) {
        return fail(`Для текущей ветки "${currentBranch}" не настроена upstream-ветка.`);
    }

    const aheadBehind = execSilent(`git rev-list --left-right --count HEAD...${upstreamBranch.trim()}`);
    if (!aheadBehind) {
        return fail(`Не удалось сравнить текущую ветку "${currentBranch}" с "${upstreamBranch.trim()}".`);
    }

    const parts = aheadBehind.trim().split(/\s+/);
    const behindBy = Number(parts[1] || 0);
    if (!Number.isFinite(behindBy)) {
        return fail(`Не удалось разобрать информацию ahead/behind для "${upstreamBranch.trim()}".`);
    }

    if (behindBy > 0) {
        return fail(`В удаленной ветке есть новые коммиты (${behindBy}). Выполните "git pull" и повторите попытку.`);
    }

    return ok({ currentBranch, upstreamBranch: upstreamBranch.trim() });
}

function requireFileExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return fail(`Обязательный файл "${filePath}" не существует.`);
    }
    return ok();
}

function requirePackageVersion() {
    const version = getVersion();
    if (!version) {
        return fail('Не удалось прочитать версию из package.json.');
    }
    if (!SEMVER_PATTERN.test(version)) {
        return fail(`Версия "${version}" не соответствует semver.`);
    }
    return ok({ version });
}

function requireStablePackageVersion() {
    const version = getVersion();
    if (!version) {
        return fail('Не удалось прочитать версию из package.json.');
    }
    if (!STABLE_SEMVER_PATTERN.test(version)) {
        return fail(`Версия "${version}" должна быть стабильным SemVer X.Y.Z без prerelease.`);
    }
    return ok({ version });
}

function compareStableVersions(left, right) {
    const leftParts = String(left).split('.').map(Number);
    const rightParts = String(right).split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
        if (leftParts[index] !== rightParts[index]) {
            return leftParts[index] - rightParts[index];
        }
    }
    return 0;
}

function requireLatestStableVersion() {
    const tagRefs = execSilent('git ls-remote --tags origin "refs/tags/v*"');
    if (tagRefs === null) {
        return fail('Не удалось получить стабильные теги из origin.');
    }

    const versions = new Set();
    for (const line of tagRefs.split('\n')) {
        const match = line.trim().match(/^[0-9a-f]+\s+refs\/tags\/v(\d+\.\d+\.\d+)(?:\^\{\})?$/i);
        if (match && STABLE_SEMVER_PATTERN.test(match[1])) {
            versions.add(match[1]);
        }
    }

    if (versions.size === 0) {
        return fail('В origin не найден стабильный тег vX.Y.Z.');
    }

    const stableVersion = [...versions].sort(compareStableVersions).at(-1);
    return ok({ stableVersion });
}

function requireStableTagAtHead(version) {
    if (!STABLE_SEMVER_PATTERN.test(String(version || ''))) {
        return fail('Для закрытия релиза требуется стабильная версия X.Y.Z.');
    }

    const head = execSilent('git rev-parse HEAD');
    const tagRefs = execSilent(`git ls-remote --tags origin "refs/tags/v${version}" "refs/tags/v${version}^{}"`);
    if (!head || tagRefs === null) {
        return fail(`Не удалось проверить стабильный тег "v${version}".`);
    }

    let tagCommit = null;
    for (const line of tagRefs.split('\n')) {
        const [sha, ref] = line.trim().split(/\s+/);
        if (ref === `refs/tags/v${version}^{}`) {
            tagCommit = sha;
            break;
        }
        if (ref === `refs/tags/v${version}`) {
            tagCommit = sha;
        }
    }

    if (!tagCommit) {
        return fail(`Стабильный тег "v${version}" отсутствует в origin.`);
    }
    if (tagCommit !== head) {
        return fail(`Стабильный тег "v${version}" указывает не на текущий commit main/master.`);
    }
    return ok({ stableVersion: version });
}

function requireYouTrackTask(task) {
    if (!YOUTRACK_TASK_PATTERN.test(String(task || ''))) {
        return fail('Номер задачи должен соответствовать формату YOUTRACK-ID, например AR-123.');
    }
    return ok({ task });
}

function requireTagMissing(tagName) {
    const localTag = execSilent(`git tag -l "${tagName}"`);
    if (localTag && localTag.trim()) {
        return fail(`Тег "${tagName}" уже существует локально.`);
    }

    const remoteTag = execSilent(`git ls-remote --tags origin "refs/tags/${tagName}"`);
    if (remoteTag && remoteTag.trim()) {
        return fail(`Тег "${tagName}" уже существует на origin.`);
    }

    return ok();
}

function requireOnReleaseBranch() {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Не удалось определить текущую ветку.');
    }
    if (!currentBranch.startsWith('release/')) {
        return fail(`Текущая ветка "${currentBranch}", ожидалась "release/*".`);
    }
    return ok({ currentBranch });
}

function requireReleaseBranchMissing(branchName) {
    const localBranch = execSilent(`git branch --list "${branchName}"`);
    if (localBranch && localBranch.trim()) {
        return fail(`Ветка "${branchName}" уже существует локально.`);
    }
    const remoteBranch = execSilent(`git ls-remote --heads origin "refs/heads/${branchName}"`);
    if (remoteBranch && remoteBranch.trim()) {
        return fail(`Ветка "${branchName}" уже существует на origin.`);
    }
    return ok();
}

function requireReleaseVersionAvailable(version) {
    if (!STABLE_SEMVER_PATTERN.test(String(version || ''))) {
        return fail('Целевая release-версия должна соответствовать X.Y.Z.');
    }

    const localBranches = execSilent(`git branch --list "release/${version}" "hotfix/*-${version}"`);
    if (localBranches && localBranches.trim()) {
        return fail(`Версия "${version}" уже используется локальной release/hotfix-веткой.`);
    }

    const remoteBranches = execSilent(`git ls-remote --heads origin "refs/heads/release/${version}" "refs/heads/hotfix/*-${version}"`);
    if (remoteBranches && remoteBranches.trim()) {
        return fail(`Версия "${version}" уже используется release/hotfix-веткой в origin.`);
    }
    return ok();
}

function requirePrettierAvailable() {
    const runner = getPrettierRunner();
    if (!runner) {
        return fail('Prettier недоступен.');
    }
    return ok({ prettierRunner: runner });
}

function requireChangelogFormatted() {
    const runner = getPrettierRunner();
    if (!runner) {
        return fail('Prettier недоступен.');
    }
    if (!execCommand(`${runner} --check CHANGELOG.md`)) {
        return fail('Файл CHANGELOG.md не прошел проверку Prettier.');
    }
    return ok({ prettierRunner: runner });
}

function findChangelogFragmentFiles(baseDir = CHANGELOG_DIR) {
    if (!fs.existsSync(baseDir)) {
        return [];
    }

    try {
        return fs.readdirSync(baseDir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
            .map((entry) => toPosixPath(path.join(baseDir, entry.name)))
            .sort();
    } catch (error) {
        return [];
    }
}

function requireChangelogFragments() {
    if (!fs.existsSync(CHANGELOG_DIR)) {
        return fail(`Директория changelog fragments "${CHANGELOG_DIR}" не существует.`);
    }

    const fragmentFiles = findChangelogFragmentFiles();
    if (fragmentFiles.length === 0) {
        return fail(`В директории "${CHANGELOG_DIR}" нет changelog fragments.`);
    }

    const changelogFragments = [];
    for (const filePath of fragmentFiles) {
        const type = getFragmentType(filePath);
        if (!type) {
            return fail(`Неверное имя changelog fragment "${filePath}". Ожидается "<name>.<type>.md".`);
        }

        let content;
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            return fail(`Не удалось прочитать changelog fragment "${filePath}".`);
        }

        const entries = content
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        if (entries.length === 0) {
            return fail(`Changelog fragment "${filePath}" пуст.`);
        }
        if (entries.some((line) => !line.startsWith('- '))) {
            return fail(`Каждая непустая строка "${filePath}" должна начинаться с "- ".`);
        }

        changelogFragments.push({
            filePath,
            type,
            section: FRAGMENT_TYPES[type].section,
            bump: FRAGMENT_TYPES[type].bump,
            entries
        });
    }

    return ok({ changelogFragments });
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
                files.push(toPosixPath(fullPath));
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
                files.push(toPosixPath(fullPath));
            }
        }
    }

    return files.sort();
}

function requireHelmReleaseFiles() {
    const helmReleaseFiles = findHelmReleaseFiles('.');
    if (helmReleaseFiles.length === 0) {
        return fail('Не удалось найти файлы helmrelease.yaml в репозитории.');
    }
    return ok({ helmReleaseFiles });
}

function requireSingleValuesYaml() {
    const valuesFiles = findValuesYamlFiles('charts');
    if (valuesFiles.length === 0) {
        return fail('Не удалось найти values.yaml по маске charts/**/values.yaml.');
    }
    if (valuesFiles.length > 1) {
        return fail(`Найдено несколько файлов values.yaml: ${valuesFiles.join(', ')}.`);
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
        return fail(`Обязательный файл "${valuesYamlPath}" не существует.`);
    }

    let content = '';
    try {
        content = fs.readFileSync(valuesYamlPath, 'utf8');
    } catch (error) {
        return fail(`Не удалось прочитать "${valuesYamlPath}".`);
    }

    const api = extractYamlList(content, 'api');
    const pages = extractYamlList(content, 'pages');
    const assets = extractYamlList(content, 'assets');

    if (api.length === 0) {
        return fail(`Отсутствует или пуст ingress.paths.api в "${valuesYamlPath}".`);
    }
    if (pages.length === 0) {
        return fail(`Отсутствует или пуст ingress.paths.pages в "${valuesYamlPath}".`);
    }
    if (assets.length === 0) {
        return fail(`Отсутствует или пуст ingress.paths.assets в "${valuesYamlPath}".`);
    }

    return ok({
        valuesIngressPaths: { api, pages, assets }
    });
}

function requireSourcePathDirectory(sourcePath) {
    if (!sourcePath || typeof sourcePath !== 'string') {
        return fail('Требуется путь к исходникам.');
    }
    const resolved = path.resolve(sourcePath);
    if (!fs.existsSync(resolved)) {
        return fail(`Путь к исходникам не существует: "${sourcePath}".`);
    }

    let stat;
    try {
        stat = fs.statSync(resolved);
    } catch (error) {
        return fail(`Не удалось получить доступ к пути исходников: "${sourcePath}".`);
    }
    if (!stat.isDirectory()) {
        return fail(`Путь к исходникам не является директорией: "${sourcePath}".`);
    }

    return ok({ sourcePath: resolved });
}

function hasNextConfig(sourcePath) {
    const files = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'];
    return files.some((fileName) => fs.existsSync(path.join(sourcePath, fileName)));
}

function requireNextProject(sourcePath) {
    if (!sourcePath) {
        return fail('Требуется путь к исходникам.');
    }

    const pkgPath = path.join(sourcePath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        return fail(`Не удалось найти package.json в "${sourcePath}".`);
    }

    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (error) {
        return fail(`Не удалось разобрать package.json в "${sourcePath}".`);
    }

    const dependencies = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
    const hasNextDependency = typeof dependencies.next === 'string';
    const nextConfigExists = hasNextConfig(sourcePath);

    if (!hasNextDependency && !nextConfigExists) {
        return fail(`"${sourcePath}" не похож на проект Next.js.`);
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
        return fail('Требуется путь к исходникам.');
    }

    const pkgPath = path.join(sourcePath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        return fail(`Не удалось найти package.json в "${sourcePath}".`);
    }

    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (error) {
        return fail(`Не удалось разобрать package.json в "${sourcePath}".`);
    }

    if (!pkg.scripts || typeof pkg.scripts.build !== 'string') {
        return fail(`В "${pkgPath}" отсутствует скрипт build.`);
    }

    return ok({ sourceBuildScript: pkg.scripts.build });
}

module.exports = {
    SEMVER_PATTERN,
    STABLE_SEMVER_PATTERN,
    YOUTRACK_TASK_PATTERN,
    getPrettierRunner,
    requireGitRepo,
    requireCleanWorkingTree,
    requireMainAndDevBranches,
    requireCurrentBranch,
    requireOnDevBranch,
    requireOnMainBranch,
    requireRemoteOrigin,
    requireRemoteReachable,
    requireCurrentBranchUpToDateWithRemote,
    requireFileExists,
    requirePackageVersion,
    requireStablePackageVersion,
    requireLatestStableVersion,
    requireStableTagAtHead,
    requireYouTrackTask,
    requireTagMissing,
    requireOnReleaseBranch,
    requireReleaseBranchMissing,
    requireReleaseVersionAvailable,
    requirePrettierAvailable,
    requireChangelogFormatted,
    findChangelogFragmentFiles,
    requireChangelogFragments,
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
