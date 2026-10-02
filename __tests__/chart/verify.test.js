#!/usr/bin/env node
const fs = require('fs');
const { runCommand } = require('../../src/cli/command-executor');
const childProcess = require('child_process');
const utils = require('../../src/common/utils');

jest.mock('fs');
jest.mock('child_process', () => ({
    execSync: jest.fn()
}));
jest.mock('../../src/common/utils', () => ({
    logSuccess: jest.fn(),
    logError: jest.fn(),
    execSilent: jest.fn(),
    execCommand: jest.fn(),
    getCurrentBranch: jest.fn(),
    getMainBranch: jest.fn(),
    getRemoteUrl: jest.fn(),
    colors: {
        green: '\x1b[32m',
        reset: '\x1b[0m'
    }
}));
jest.mock('../../src/cli/command-executor', () => ({
    runCommand: jest.fn()
}));

const chart = require('../../src/chart');

function normalizePath(p) {
    return String(p).replace(/\\/g, '/');
}

describe('Chart verify', () => {
    const originalLog = console.log;
    const originalFetch = global.fetch;
    const originalToken = process.env.SC_OWNER_PAT;
    beforeEach(() => {
        jest.clearAllMocks();
        console.log = jest.fn();
    });
    afterAll(() => {
        console.log = originalLog;
        global.fetch = originalFetch;
        if (originalToken === undefined) {
            delete process.env.SC_OWNER_PAT;
        } else {
            process.env.SC_OWNER_PAT = originalToken;
        }
    });

    describe('normalizeList', () => {
        test('should trim and deduplicate preserving order', () => {
            expect(chart.normalizeList([' /a ', '/b', '/a', '', null])).toEqual(['/a', '/b']);
        });
    });

    describe('normalizeToBeList', () => {
        test('should append $ to each pattern', () => {
            expect(chart.normalizeToBeList(['/api/users', '/api/orders$', ' /page '])).toEqual([
                '/api/users$',
                '/api/orders$',
                '/page$'
            ]);
        });
    });

    describe('buildGitLikeDiff', () => {
        test('should compute added and removed values', () => {
            const diff = chart.buildGitLikeDiff(['/a', '/b'], ['/b', '/c'], 'api');
            expect(diff.removed).toEqual(['/a']);
            expect(diff.added).toEqual(['/c']);
            expect(diff.unchanged).toEqual(['/b']);
            expect(diff.text).toContain('--- AS_IS/api');
            expect(diff.text).toContain('+++ TO_BE/api');
            expect(diff.text).toContain('-/a');
            expect(diff.text).toContain('+/c');
        });
    });

    describe('collectRoutesFromFilesystem', () => {
        test('should collect api and pages routes', () => {
            fs.existsSync.mockImplementation((filePath) => {
                const np = normalizePath(filePath);
                return (
                    np === '/src/app' ||
                    np === '/src/app/api' ||
                    np === '/src/pages' ||
                    np === '/src/pages/api'
                );
            });

            fs.readdirSync.mockImplementation((dirPath) => {
                const nd = normalizePath(dirPath);
                if (nd === '/src/app') {
                    return [
                        { name: 'api', isDirectory: () => true, isFile: () => false },
                        { name: 'blog', isDirectory: () => true, isFile: () => false },
                        { name: 'page.tsx', isDirectory: () => false, isFile: () => true }
                    ];
                }
                if (nd === '/src/app/api') {
                    return [
                        { name: 'users', isDirectory: () => true, isFile: () => false },
                        { name: 'route.ts', isDirectory: () => false, isFile: () => true }
                    ];
                }
                if (nd === '/src/app/api/users') {
                    return [
                        { name: 'route.ts', isDirectory: () => false, isFile: () => true }
                    ];
                }
                if (nd === '/src/app/blog') {
                    return [
                        { name: 'page.tsx', isDirectory: () => false, isFile: () => true }
                    ];
                }
                if (nd === '/src/pages') {
                    return [
                        { name: 'api', isDirectory: () => true, isFile: () => false },
                        { name: 'index.tsx', isDirectory: () => false, isFile: () => true },
                        { name: 'about.tsx', isDirectory: () => false, isFile: () => true },
                        { name: '_app.tsx', isDirectory: () => false, isFile: () => true }
                    ];
                }
                if (nd === '/src/pages/api') {
                    return [
                        { name: 'health.ts', isDirectory: () => false, isFile: () => true }
                    ];
                }
                return [];
            });

            const routes = chart.collectRoutesFromFilesystem('/src');
            expect(routes.api).toEqual(expect.arrayContaining(['/api/users', '/api', '/api/health']));
            expect(routes.api).toHaveLength(3);
            expect(routes.pages).toEqual(expect.arrayContaining(['/blog', '/', '/about']));
            expect(routes.pages).toHaveLength(3);
        });
    });

    describe('collectRoutesFromBuildArtifacts', () => {
        test('should collect routes from manifests', () => {
            fs.existsSync.mockImplementation((p) => {
                const np = normalizePath(p);
                return (
                    np === '/src/.next/routes-manifest.json' ||
                    np === '/src/.next/server/app-path-routes-manifest.json' ||
                    np === '/src/.next/server/pages-manifest.json'
                );
            });
            fs.readFileSync.mockImplementation((p) => {
                const np = normalizePath(p);
                if (np.endsWith('app-path-routes-manifest.json')) {
                    return JSON.stringify({ '/app/api/users': '/api/users', '/app/page': '/' });
                }
                if (np.endsWith('pages-manifest.json')) {
                    return JSON.stringify({ '/api/health': 'x', '/': 'x', '/_app': 'x' });
                }
                if (np.endsWith('routes-manifest.json')) {
                    return JSON.stringify({
                        staticRoutes: [{ page: '/about' }],
                        dynamicRoutes: [{ page: '/blog/[slug]' }],
                        dataRoutes: [{ route: '/api/data' }]
                    });
                }
                return '{}';
            });

            const routes = chart.collectRoutesFromBuildArtifacts('/src');
            expect(routes.api).toEqual(expect.arrayContaining(['/api/data', '/api/users', '/api/health']));
            expect(routes.pages).toEqual(expect.arrayContaining(['/about', '/blog/[slug]', '/']));
        });
    });

    describe('chartVerify', () => {
        test('should call shared executor', async () => {
            runCommand.mockResolvedValue(true);
            await expect(chart.chartVerify('/tmp/source')).resolves.toBe(true);
            expect(runCommand).toHaveBeenCalled();
        });

        test('should run compare step with no changes', async () => {
            runCommand.mockImplementation(async (spec) => spec.steps[1].run({
                valuesIngressPaths: { api: ['/a$'], pages: ['/b$'], assets: ['/c$'] },
                toBeIngressPaths: { api: ['/a$'], pages: ['/b$'], assets: ['/c$'] }
            }));
            await expect(chart.chartVerify('/tmp/source')).resolves.toBe(true);
        });

        test('should run compare step with differences', async () => {
            runCommand.mockImplementation(async (spec) => spec.steps[1].run({
                valuesIngressPaths: { api: ['/a$'], pages: [], assets: [] },
                toBeIngressPaths: { api: ['/b$'], pages: [], assets: [] }
            }));
            await expect(chart.chartVerify('/tmp/source')).resolves.toBe(false);
        });
    });

});
