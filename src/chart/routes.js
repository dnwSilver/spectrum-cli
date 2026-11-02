const fs = require('fs');
const path = require('path');
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

module.exports = { normalizeList, normalizeToBeList, collectRoutesFromFilesystem, collectRoutesFromBuildArtifacts };
