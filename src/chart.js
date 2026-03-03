#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');
const { logSuccess, logError, execCommand, execSilent, colors } = require('./utils');
const { runCommand } = require('./command-executor');
const {
    requireGitRepo,
    requireCleanWorkingTree,
    requireOnMainBranch,
    requireCurrentBranchUpToDateWithRemote,
    requireRemoteOrigin,
    requireRemoteReachable,
    requireSingleChart,
    requireTagMissing,
    requireHelmReleaseFiles,
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
            { name: 'branch-up-to-date', run: requireCurrentBranchUpToDateWithRemote },
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
            { name: 'branch-up-to-date', run: requireCurrentBranchUpToDateWithRemote },
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

function updateHelmReleaseVersion(filePath, nextVersion) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const keyStack = [];
    const oldVersions = [];
    let changed = false;

    const updatedLines = lines.map((line) => {
        const keyMatch = line.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
        if (!keyMatch || line.trim().startsWith('#')) {
            return line;
        }

        const indent = keyMatch[1].length;
        const key = keyMatch[2];

        while (keyStack.length > 0 && keyStack[keyStack.length - 1].indent >= indent) {
            keyStack.pop();
        }

        const parentPath = keyStack.map((item) => item.key).join('.');
        keyStack.push({ key, indent });
        if (!(parentPath === 'spec.chart.spec' && key === 'version')) {
            return line;
        }

        const valuePart = keyMatch[3];
        const valueMatch = valuePart.match(/^(\s*)(['"]?)([^'"#\s]+)\2(\s*(?:#.*)?)$/);
        if (!valueMatch) {
            return line;
        }

        const oldVersion = valueMatch[3];
        oldVersions.push(oldVersion);
        if (oldVersion === nextVersion) {
            return line;
        }

        changed = true;
        const spacing = valueMatch[1] || ' ';
        return `${keyMatch[1]}version:${spacing}${valueMatch[2]}${nextVersion}${valueMatch[2]}${valueMatch[4]}`;
    });

    if (changed) {
        fs.writeFileSync(filePath, updatedLines.join('\n'));
    }

    const uniqueOld = Array.from(new Set(oldVersions));
    return {
        filePath,
        oldVersion: uniqueOld.length > 0 ? uniqueOld.join(', ') : 'unknown',
        newVersion: nextVersion,
        changed
    };
}

function printDeployChanges(changes) {
    changes.forEach((item) => {
        const icon = item.changed ? '●' : '○';
        const color = item.changed ? colors.green : '\x1b[90m';
        console.log(
            `${color}${icon} ${item.filePath}: ${item.oldVersion} -> ${item.newVersion}${colors.reset}`
        );
    });
}

function waitForEnter(promptText) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(promptText, () => {
            rl.close();
            resolve(true);
        });
    });
}

function splitGitNameOnly(output) {
    if (output === null || output === undefined) {
        return null;
    }
    return String(output)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

function chartDeploy() {
    return runCommand({
        name: 'chart deploy',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'clean-working-tree', run: requireCleanWorkingTree },
            { name: 'on-main-branch', run: requireOnMainBranch },
            { name: 'branch-up-to-date', run: requireCurrentBranchUpToDateWithRemote },
            { name: 'remote-origin', run: requireRemoteOrigin },
            { name: 'remote-reachable', run: requireRemoteReachable },
            { name: 'single-chart', run: requireSingleChart },
            { name: 'helmrelease-files', run: requireHelmReleaseFiles }
        ],
        steps: [
            {
                name: 'resolve-latest-chart-version',
                run: (ctx) => {
                    const latestVersion = getLatestRemoteChartVersion(ctx.chartName);
                    if (!latestVersion) {
                        logError('❌', 'Cannot find remote chart tag for %s.', ctx.chartName);
                        return false;
                    }
                    ctx.latestChartVersion = latestVersion;
                    logSuccess('🏷️', 'Latest remote chart version for %s is %s.', ctx.chartName, latestVersion);
                    return true;
                }
            },
            {
                name: 'update-helmrelease-files',
                run: (ctx) => {
                    const changes = (ctx.helmReleaseFiles || []).map((filePath) => updateHelmReleaseVersion(filePath, ctx.latestChartVersion));
                    ctx.deployChanges = changes;
                    ctx.updatedFiles = changes.filter((item) => item.changed).map((item) => item.filePath);

                    printDeployChanges(changes);
                    if (ctx.updatedFiles.length === 0) {
                        ctx.noUpdates = true;
                        logSuccess('✅', 'All helmrelease.yaml files are already on latest chart version.');
                        return true;
                    }

                    return true;
                }
            },
            {
                name: 'confirm-publish',
                run: async (ctx) => {
                    if (ctx.noUpdates) {
                        return true;
                    }
                    await waitForEnter('Готов ли ты к публикации? Нажми Enter для продолжения (Ctrl+C для отмены): ');
                    return true;
                }
            },
            {
                name: 'commit-and-push',
                run: (ctx) => {
                    if (ctx.noUpdates) {
                        return true;
                    }
                    const files = ctx.updatedFiles || [];
                    if (files.length === 0) {
                        logSuccess('✅', 'No files were changed.');
                        return true;
                    }

                    const stagedBeforeAdd = splitGitNameOnly(execSilent('git diff --cached --name-only'));
                    const unstagedBeforeAdd = splitGitNameOnly(execSilent('git diff --name-only'));
                    if (stagedBeforeAdd === null || unstagedBeforeAdd === null) {
                        logError('❌', 'Cannot verify changed files before commit.');
                        return false;
                    }
                    if (stagedBeforeAdd.length > 0) {
                        logError('❌', 'Unexpected staged changes detected: %s', stagedBeforeAdd.join(', '));
                        return false;
                    }

                    const expectedSet = new Set(files);
                    const unexpectedChanges = unstagedBeforeAdd.filter((filePath) => !expectedSet.has(filePath));
                    if (unexpectedChanges.length > 0) {
                        logError('❌', 'Unexpected file changes detected: %s', unexpectedChanges.join(', '));
                        return false;
                    }

                    const missingExpectedChanges = files.filter((filePath) => !unstagedBeforeAdd.includes(filePath));
                    if (missingExpectedChanges.length > 0) {
                        logError('❌', 'Expected updated files are missing in diff: %s', missingExpectedChanges.join(', '));
                        return false;
                    }

                    const quoted = files.map((filePath) => `"${filePath}"`).join(' ');
                    if (!execCommand(`git add ${quoted}`)) {
                        logError('❌', 'Cannot add updated helmrelease files.');
                        return false;
                    }

                    const stagedAfterAdd = splitGitNameOnly(execSilent('git diff --cached --name-only'));
                    if (stagedAfterAdd === null) {
                        logError('❌', 'Cannot verify staged files after git add.');
                        return false;
                    }
                    const unexpectedStaged = stagedAfterAdd.filter((filePath) => !expectedSet.has(filePath));
                    const missingStaged = files.filter((filePath) => !stagedAfterAdd.includes(filePath));
                    if (unexpectedStaged.length > 0 || missingStaged.length > 0) {
                        if (unexpectedStaged.length > 0) {
                            logError('❌', 'Unexpected staged files detected: %s', unexpectedStaged.join(', '));
                        }
                        if (missingStaged.length > 0) {
                            logError('❌', 'Expected files are not staged: %s', missingStaged.join(', '));
                        }
                        return false;
                    }

                    if (!execCommand('git commit -m "🚀 Deploy service."')) {
                        logError('❌', 'Cannot create deploy commit.');
                        return false;
                    }
                    if (!execCommand('git push')) {
                        logError('❌', 'Cannot push deploy commit.');
                        return false;
                    }

                    logSuccess('🚀', 'Deploy commit is pushed.');
                    return true;
                }
            }
        ]
    });
}

module.exports = {
    chartCreateTag,
    chartDeploy,
    chartVerify,
    normalizeList,
    normalizeToBeList,
    collectRoutesFromFilesystem,
    collectRoutesFromBuildArtifacts,
    buildGitLikeDiff,
    getChartName,
    getChartFiles,
    isSemver,
    compareSemver,
    getLatestRemoteChartVersion,
    updateHelmReleaseVersion
};
