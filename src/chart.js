#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { logSuccess, logError, execCommand, colors } = require('./utils');
const { runCommand } = require('./command-executor');
const {
    requireGitRepo,
    requireCleanWorkingTree,
    requireOnMainBranch,
    requireSingleChart,
    requireTagMissing,
    requireSingleValuesYaml,
    requireIngressPathSections,
    requireSourcePathDirectory,
    requireNextProject,
    requireBuildCommandSupport,
    SEMVER_PATTERN
} = require('./preflight');

const CHARTS_DIR = 'charts';
const FIXED_ASSET_PATHS = [
    '/_next/image$',
    '/_next/static/media/[a-z0-9_\\.\\-]+\\.(woff|woff2|ttf|otf|eot)$',
    '/_next/static/chunks/[a-z0-9_\\.\\-]+\\.(css|js)$',
    '/_next/static/[a-zA-Z0-9_-]+/_ssgManifest.js$',
    '/_next/static/[a-zA-Z0-9_-]+/_buildManifest.js$',
    '/_next/static/[a-zA-Z0-9_-]+/_clientMiddlewareManifest.json$',
    '/[^?]+\\.(?:ico|svg|png|jpg|jpeg|gif|webp|txt|map)$'
];

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

function normalizeList(list) {
    const result = [];
    const seen = new Set();
    for (const item of (Array.isArray(list) ? list : [])) {
        const value = String(item || '').trim();
        if (!value || seen.has(value)) {
            continue;
        }
        seen.add(value);
        result.push(value);
    }
    return result;
}

function ensureEndsWithDollar(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    return text.endsWith('$') ? text : `${text}$`;
}

function normalizeToBeList(list) {
    return normalizeList(list.map(ensureEndsWithDollar));
}

function segmentToPattern(segment) {
    if (segment === 'index') {
        return '';
    }
    if (/^\[\[\.\.\..+\]\]$/.test(segment)) {
        return '.*';
    }
    if (/^\[\.\.\..+\]$/.test(segment)) {
        return '.+';
    }
    if (/^\[.+\]$/.test(segment)) {
        return '[^/]+';
    }
    return segment;
}

function toRouteFromFileSegments(segments) {
    const transformed = segments.map(segmentToPattern).filter(Boolean);
    const route = `/${transformed.join('/')}`.replace(/\/+/g, '/');
    return route === '' ? '/' : route;
}

function parseApiRouteFromAppFile(filePath) {
    const rel = filePath.replace(/\\/g, '/').replace(/^app\/api\//, '').replace(/(^|\/)route\.[^.]+$/, '');
    if (!rel) {
        return '/api';
    }
    return `/api/${toRouteFromFileSegments(rel.split('/')).replace(/^\//, '')}`.replace(/\/+$/, '');
}

function parseApiRouteFromPagesFile(filePath) {
    const rel = filePath.replace(/\\/g, '/').replace(/^pages\/api\//, '').replace(/\.[^.]+$/, '');
    const route = toRouteFromFileSegments(rel.split('/'));
    return `/api${route === '/' ? '' : route}`.replace(/\/+$/, '') || '/api';
}

function parsePageRouteFromPagesFile(filePath) {
    const rel = filePath.replace(/\\/g, '/').replace(/^pages\//, '').replace(/\.[^.]+$/, '');
    const chunks = rel.split('/').filter(Boolean);
    const first = chunks[0] || '';
    const excludedFiles = new Set(['_app', '_document', '_error', '404', '500']);
    if (first === 'api' || excludedFiles.has(first)) {
        return null;
    }
    return toRouteFromFileSegments(chunks);
}

function parsePageRouteFromAppFile(filePath) {
    const rel = filePath.replace(/\\/g, '/').replace(/^app\//, '').replace(/(^|\/)page\.[^.]+$/, '');
    if (rel.startsWith('api/')) {
        return null;
    }
    if (!rel) {
        return '/';
    }
    const chunks = rel
        .split('/')
        .filter(Boolean)
        .filter((part) => !/^\(.+\)$/.test(part) && !part.startsWith('@'));
    return toRouteFromFileSegments(chunks);
}

function collectFilesRecursively(dirPath, matcher) {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    const stack = [dirPath];
    const found = [];
    while (stack.length > 0) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (error) {
            return found;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (entry.isFile() && matcher(fullPath)) {
                found.push(fullPath);
            }
        }
    }
    return found;
}

function collectRoutesFromFilesystem(sourcePath) {
    const api = [];
    const pages = [];
    const appDirCandidates = [path.join(sourcePath, 'app'), path.join(sourcePath, 'src', 'app')];
    const pagesDirCandidates = [path.join(sourcePath, 'pages'), path.join(sourcePath, 'src', 'pages')];

    for (const appDir of appDirCandidates) {
        const appApiFiles = collectFilesRecursively(
            path.join(appDir, 'api'),
            (file) => /[\\/]route\.(js|jsx|ts|tsx|mjs|cjs)$/.test(file)
        );
        for (const absFile of appApiFiles) {
            const rel = path.relative(path.join(appDir, 'api'), absFile).replace(/\\/g, '/');
            api.push(parseApiRouteFromAppFile(`app/api/${rel}`));
        }

        const appPageFiles = collectFilesRecursively(appDir, (file) => /[\\/]page\.(js|jsx|ts|tsx|mdx)$/.test(file));
        for (const absFile of appPageFiles) {
            const rel = path.relative(appDir, absFile).replace(/\\/g, '/');
            const route = parsePageRouteFromAppFile(`app/${rel}`);
            if (route) {
                pages.push(route);
            }
        }
    }

    for (const pagesDir of pagesDirCandidates) {
        const pagesApiFiles = collectFilesRecursively(path.join(pagesDir, 'api'), (file) => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(file));
        for (const absFile of pagesApiFiles) {
            const rel = path.relative(path.join(pagesDir, 'api'), absFile).replace(/\\/g, '/');
            api.push(parseApiRouteFromPagesFile(`pages/api/${rel}`));
        }

        const pagesFiles = collectFilesRecursively(pagesDir, (file) => /\.(js|jsx|ts|tsx|mdx)$/.test(file));
        for (const absFile of pagesFiles) {
            const rel = path.relative(pagesDir, absFile).replace(/\\/g, '/');
            const route = parsePageRouteFromPagesFile(`pages/${rel}`);
            if (route) {
                pages.push(route);
            }
        }
    }

    return {
        api: normalizeList(api),
        pages: normalizeList(pages)
    };
}

function readJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return null;
    }
}

function collectRoutesFromBuildArtifacts(sourcePath) {
    const api = [];
    const pages = [];

    const routesManifest = readJsonIfExists(path.join(sourcePath, '.next', 'routes-manifest.json'));
    if (routesManifest) {
        const combined = []
            .concat(routesManifest.staticRoutes || [])
            .concat(routesManifest.dynamicRoutes || [])
            .concat(routesManifest.dataRoutes || []);
        for (const routeInfo of combined) {
            const route = routeInfo.page || routeInfo.pathname || routeInfo.route;
            if (!route || typeof route !== 'string') {
                continue;
            }
            if (route.startsWith('/api')) {
                api.push(route);
            } else {
                pages.push(route);
            }
        }
    }

    const appRoutesManifest = readJsonIfExists(path.join(sourcePath, '.next', 'server', 'app-path-routes-manifest.json'))
        || readJsonIfExists(path.join(sourcePath, '.next', 'server', 'app-paths-manifest.json'))
        || readJsonIfExists(path.join(sourcePath, '.next', 'app-path-routes-manifest.json'));
    if (appRoutesManifest && typeof appRoutesManifest === 'object') {
        Object.entries(appRoutesManifest).forEach(([key, routeValue]) => {
            const route = typeof routeValue === 'string' ? routeValue : key;
            if (typeof route !== 'string') {
                return;
            }
            if (route.startsWith('/_')) {
                return;
            }
            if (route.startsWith('/api')) {
                api.push(route);
            } else {
                pages.push(route);
            }
        });
    }

    const pagesManifest = readJsonIfExists(path.join(sourcePath, '.next', 'server', 'pages-manifest.json'));
    if (pagesManifest && typeof pagesManifest === 'object') {
        Object.keys(pagesManifest).forEach((route) => {
            if (route === '/_app' || route === '/_document' || route === '/_error' || route === '/404' || route === '/500') {
                return;
            }
            if (route.startsWith('/api')) {
                api.push(route);
            } else {
                pages.push(route);
            }
        });
    }

    return {
        api: normalizeList(api),
        pages: normalizeList(pages)
    };
}

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

    console.log(`\n${title} paths diff (AS IS -> TO BE):`);
    console.log(`--- AS_IS/${title}`);
    console.log(`+++ TO_BE/${title}`);
    console.log(`@@ ${title} @@`);
    if (diff.removed.length === 0 && diff.added.length === 0) {
        console.log('  (no changes)');
    } else {
        diff.removed.forEach((item) => console.log(`${colors.yellow}-${item}${colors.reset}`));
        diff.added.forEach((item) => console.log(`${colors.red}+${item}${colors.reset}`));
    }
    console.log(`${title} summary: added=${diff.added.length}, removed=${diff.removed.length}, unchanged=${diff.unchanged.length}`);

    return diff;
}

function chartVerify(sourcePath) {
    return runCommand({
        name: 'chart verify',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'single-values-yaml', run: requireSingleValuesYaml },
            { name: 'values-ingress-sections', run: (ctx) => requireIngressPathSections(ctx.valuesYamlPath) },
            { name: 'source-path-directory', run: () => requireSourcePathDirectory(sourcePath) },
            { name: 'next-project', run: (ctx) => requireNextProject(ctx.sourcePath) },
            { name: 'build-command-support', run: (ctx) => requireBuildCommandSupport(ctx.sourcePath) }
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
                            logSuccess('🛠️', 'Build completed in %s.', ctx.sourcePath);
                            const rebuilt = collectRoutesFromBuildArtifacts(ctx.sourcePath);
                            api = normalizeList(api.concat(rebuilt.api));
                            pages = normalizeList(pages.concat(rebuilt.pages));
                        } else {
                            logError('⚠️', 'Build failed in %s. Falling back to filesystem routes.', ctx.sourcePath);
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
                        logError('❌', '[chart verify] Differences detected.');
                        return false;
                    }

                    logSuccess('✅', '[chart verify] AS IS matches TO BE.');
                    return true;
                }
            }
        ]
    });
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
    chartVerify,
    normalizeList,
    normalizeToBeList,
    collectRoutesFromFilesystem,
    collectRoutesFromBuildArtifacts,
    buildGitLikeDiff,
    getChartName,
    getChartFiles,
    isSemver
};
