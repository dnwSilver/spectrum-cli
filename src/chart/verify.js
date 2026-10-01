const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { logSuccess, logError, colors } = require('../common/utils');
const { runCommand } = require('../cli/command-executor');
const { requireGitRepo, requireCurrentBranchUpToDateWithRemote, requireSingleValuesYaml, requireIngressPathSections, requireSourcePathDirectory, requireNextProject, requireBuildCommandSupport } = require('../preflight');
const { normalizeList, normalizeToBeList, collectRoutesFromFilesystem, collectRoutesFromBuildArtifacts } = require('./routes');
const FIXED_ASSET_PATHS = [
    '/_next/image$',
    '/_next/static/media/[a-z0-9_\\.\\-]+\\.(woff|woff2|ttf|otf|eot)$',
    '/_next/static/chunks/[a-z0-9_\\.\\-]+\\.(css|js)$',
    '/_next/static/[a-zA-Z0-9_-]+/_ssgManifest.js$',
    '/_next/static/[a-zA-Z0-9_-]+/_buildManifest.js$',
    '/_next/static/[a-zA-Z0-9_-]+/_clientMiddlewareManifest.json$',
    '/[^?]+\\.(?:ico|svg|png|jpg|jpeg|gif|webp|txt|map)$'
];

function runBuildInSourcePath(sourcePath, packageManager) {
    const manager = packageManager || 'npm';
    const hasNodeModules = fs.existsSync(path.join(sourcePath, 'node_modules'));
    const hasPackageLock = fs.existsSync(path.join(sourcePath, 'package-lock.json'));
    const hasYarnLock = fs.existsSync(path.join(sourcePath, 'yarn.lock'));
    const hasBunLock = fs.existsSync(path.join(sourcePath, 'bun.lockb'));
    const installCommand = manager === 'yarn'
        ? (hasYarnLock ? 'yarn install --frozen-lockfile' : 'yarn install')
        : manager === 'bun'
            ? 'bun install'
            : (hasPackageLock ? 'npm ci' : 'npm install');
    const buildCommand = manager === 'yarn' ? 'yarn build' : manager === 'bun' ? 'bun run build' : 'npm run build';

    try {
        if (!hasNodeModules) {
            execSync(installCommand, { cwd: sourcePath, stdio: 'pipe', timeout: 600000 });
        } else if (!hasPackageLock && !hasYarnLock && !hasBunLock) {
            execSync(installCommand, { cwd: sourcePath, stdio: 'pipe', timeout: 600000 });
        }

        execSync(buildCommand, { cwd: sourcePath, stdio: 'pipe', timeout: 900000 });
        return true;
    } catch (error) {
        return false;
    }
}

function buildGitLikeDiff(asIsList, toBeList, title) {
    const asIs = normalizeList(asIsList);
    const toBe = normalizeList(toBeList);
    const asIsSet = new Set(asIs);
    const toBeSet = new Set(toBe);
    const removed = asIs.filter((item) => !toBeSet.has(item));
    const added = toBe.filter((item) => !asIsSet.has(item));
    const unchanged = asIs.filter((item) => toBeSet.has(item));

    const lines = [
        `--- AS_IS/${title}`,
        `+++ TO_BE/${title}`,
        `@@ ${title} @@`
    ];
    removed.forEach((item) => lines.push(`-${item}`));
    added.forEach((item) => lines.push(`+${item}`));
    if (removed.length === 0 && added.length === 0) {
        lines.push('  (no changes)');
    }

    return {
        removed,
        added,
        unchanged,
        text: lines.join('\n')
    };
}

function printSection(title, asIsList, toBeList) {
    const asIs = normalizeList(asIsList);
    const toBe = normalizeList(toBeList);
    const diff = buildGitLikeDiff(asIs, toBe, title);

    console.log(`\nСравнение путей ${title} (КАК ЕСТЬ -> КАК ДОЛЖНО БЫТЬ):`);
    console.log(`--- AS_IS/${title}`);
    console.log(`+++ TO_BE/${title}`);
    console.log(`@@ ${title} @@`);
    if (diff.removed.length === 0 && diff.added.length === 0) {
        console.log('  (без изменений)');
    } else {
        diff.removed.forEach((item) => console.log(`${colors.yellow}-${item}${colors.reset}`));
        diff.added.forEach((item) => console.log(`${colors.red}+${item}${colors.reset}`));
    }
    console.log(`${title} сводка: добавлено=${diff.added.length}, удалено=${diff.removed.length}, без изменений=${diff.unchanged.length}`);

    return diff;
}

function chartVerify(sourcePath) {
    return runCommand({
        name: 'chart verify',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'branch-up-to-date', run: requireCurrentBranchUpToDateWithRemote },
            { name: 'single-values-yaml', run: requireSingleValuesYaml },
            { name: 'values-ingress-sections', requires: ['valuesYamlPath'], run: (ctx) => requireIngressPathSections(ctx.valuesYamlPath) },
            { name: 'source-path-directory', run: () => requireSourcePathDirectory(sourcePath) },
            { name: 'next-project', requires: ['sourcePath'], run: (ctx) => requireNextProject(ctx.sourcePath) },
            { name: 'build-command-support', requires: ['sourcePath'], run: (ctx) => requireBuildCommandSupport(ctx.sourcePath) }
        ],
        steps: [
            {
                name: 'collect-routes',
                run: (ctx) => {
                    const fromBuild = collectRoutesFromBuildArtifacts(ctx.sourcePath);
                    let api = normalizeList(fromBuild.api);
                    let pages = normalizeList(fromBuild.pages);

                    if (api.length === 0 || pages.length === 0) {
                        const didBuild = runBuildInSourcePath(ctx.sourcePath, ctx.sourcePackageManager);
                        if (didBuild) {
                            logSuccess('🛠️', 'Сборка успешно завершена в %s.', ctx.sourcePath);
                            const rebuilt = collectRoutesFromBuildArtifacts(ctx.sourcePath);
                            api = normalizeList(api.concat(rebuilt.api));
                            pages = normalizeList(pages.concat(rebuilt.pages));
                        } else {
                            logError('⚠️', 'Сборка в %s не удалась. Переходим к маршрутам из файловой системы.', ctx.sourcePath);
                        }
                    }

                    const fromFs = collectRoutesFromFilesystem(ctx.sourcePath);
                    api = normalizeList(api.concat(fromFs.api));
                    pages = normalizeList(pages.concat(fromFs.pages));

                    ctx.toBeIngressPaths = {
                        api: normalizeToBeList(api),
                        pages: normalizeToBeList(pages),
                        assets: normalizeToBeList(FIXED_ASSET_PATHS)
                    };
                    return true;
                }
            },
            {
                name: 'compare-and-report',
                run: (ctx) => {
                    const asIs = ctx.valuesIngressPaths || { api: [], pages: [], assets: [] };
                    const toBe = ctx.toBeIngressPaths || { api: [], pages: [], assets: [] };

                    const apiDiff = printSection('api', asIs.api, toBe.api);
                    const pagesDiff = printSection('pages', asIs.pages, toBe.pages);
                    const assetsDiff = printSection('assets', asIs.assets, toBe.assets);

                    const hasChanges = (
                        apiDiff.added.length + apiDiff.removed.length +
                        pagesDiff.added.length + pagesDiff.removed.length +
                        assetsDiff.added.length + assetsDiff.removed.length
                    ) > 0;

                    if (hasChanges) {
                        logError('❌', 'Обнаружены различия.');
                        return false;
                    }

                    logSuccess('✅', 'КАК ЕСТЬ совпадает с КАК ДОЛЖНО БЫТЬ.');
                    return true;
                }
            }
        ]
    });
}

module.exports = { chartVerify, buildGitLikeDiff };
