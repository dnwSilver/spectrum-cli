#!/usr/bin/env node
const fs = require('fs');
const { runCommand } = require('../src/command-executor');
const childProcess = require('child_process');
const utils = require('../src/utils');

jest.mock('fs');
jest.mock('child_process', () => ({
    execSync: jest.fn()
}));
jest.mock('../src/utils', () => ({
    logSuccess: jest.fn(),
    logError: jest.fn(),
    execSilent: jest.fn(),
    execCommand: jest.fn(),
    getCurrentBranch: jest.fn(),
    getMainBranch: jest.fn(),
    colors: {
        green: '\x1b[32m',
        reset: '\x1b[0m'
    }
}));
jest.mock('../src/command-executor', () => ({
    runCommand: jest.fn()
}));

const chart = require('../src/chart');

describe('Chart', () => {
    const originalLog = console.log;
    beforeEach(() => {
        jest.clearAllMocks();
        console.log = jest.fn();
    });
    afterAll(() => {
        console.log = originalLog;
    });

    describe('isSemver', () => {
        test('should return true for valid semver', () => {
            expect(chart.isSemver('1.2.3')).toBe(true);
            expect(chart.isSemver('0.0.1')).toBe(true);
            expect(chart.isSemver('1.2.3-alpha.1')).toBe(true);
            expect(chart.isSemver('1.2.3+build.5')).toBe(true);
        });

        test('should return false for invalid semver', () => {
            expect(chart.isSemver('1.2')).toBe(false);
            expect(chart.isSemver('1.2.3.4')).toBe(false);
            expect(chart.isSemver('v1.2.3')).toBe(false);
            expect(chart.isSemver('latest')).toBe(false);
        });
    });

    describe('getChartFiles', () => {
        test('should return empty array when charts dir does not exist', () => {
            fs.existsSync.mockImplementation((filePath) => filePath !== 'charts');
            expect(chart.getChartFiles()).toEqual([]);
        });

        test('should return chart file paths from charts subdirs', () => {
            fs.existsSync.mockImplementation((filePath) => (
                filePath === 'charts' ||
                filePath === 'charts/site-a/Chart.yaml' ||
                filePath === 'charts/site-b/Chart.yaml'
            ));
            fs.readdirSync.mockReturnValue([
                { name: 'site-a', isDirectory: () => true },
                { name: 'site-b', isDirectory: () => true },
                { name: 'README.md', isDirectory: () => false }
            ]);

            expect(chart.getChartFiles()).toEqual([
                'charts/site-a/Chart.yaml',
                'charts/site-b/Chart.yaml'
            ]);
        });

        test('should return empty array on fs error', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readdirSync.mockImplementation(() => {
                throw new Error('fs error');
            });
            expect(chart.getChartFiles()).toEqual([]);
        });
    });

    describe('getChartName', () => {
        test('should return null for empty path', () => {
            expect(chart.getChartName('')).toBeNull();
        });

        test('should read chart name from Chart.yaml', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('apiVersion: v2\nname: mychart\nversion: 1.0.0\n');
            expect(chart.getChartName('charts/mychart/Chart.yaml')).toBe('mychart');
        });

        test('should return null if chart file has no name', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('apiVersion: v2\nversion: 1.0.0\n');
            expect(chart.getChartName('charts/mychart/Chart.yaml')).toBeNull();
        });

        test('should return null when read fails', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockImplementation(() => {
                throw new Error('fail');
            });
            expect(chart.getChartName('charts/mychart/Chart.yaml')).toBeNull();
        });
    });

    describe('updateHelmReleaseVersion', () => {
        test('should update spec.chart.spec.version', () => {
            fs.readFileSync.mockReturnValue([
                'spec:',
                '  chart:',
                '    spec:',
                '      chart: app',
                '      version: 1.2.3'
            ].join('\n'));
            const result = chart.updateHelmReleaseVersion('apps/app/helmrelease.yaml', '1.4.0');
            expect(result.changed).toBe(true);
            expect(result.oldVersion).toBe('1.2.3');
            expect(fs.writeFileSync).toHaveBeenCalled();
            expect(fs.writeFileSync.mock.calls[0][1]).toContain('version: 1.4.0');
        });

        test('should keep file untouched when version is already latest', () => {
            fs.readFileSync.mockReturnValue([
                'spec:',
                '  chart:',
                '    spec:',
                '      version: 1.4.0'
            ].join('\n'));
            const result = chart.updateHelmReleaseVersion('apps/app/helmrelease.yaml', '1.4.0');
            expect(result.changed).toBe(false);
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });
    });

    describe('chartCreateTag', () => {
        test('should call shared executor', async () => {
            runCommand.mockResolvedValue(true);
            await expect(chart.chartCreateTag('1.2.3')).resolves.toBe(true);
            expect(runCommand).toHaveBeenCalled();
        });

        test('should pass invalid semver check in spec', async () => {
            runCommand.mockImplementation(async (spec) => spec.checks[3].run({}));
            await expect(chart.chartCreateTag('1.2')).resolves.toEqual({
                ok: false,
                reason: 'Version "1.2" is not a valid semver.'
            });
        });

        test('should execute create and push steps', async () => {
            utils.execCommand.mockReturnValue(true);
            runCommand.mockImplementation(async (spec) => {
                const ctx = { chartName: 'app', version: '1.2.3' };
                return spec.steps[0].run(ctx) && spec.steps[1].run(ctx);
            });
            await expect(chart.chartCreateTag('1.2.3')).resolves.toBe(true);
            expect(utils.execCommand).toHaveBeenCalledWith('git tag "chart-app-1.2.3"');
            expect(utils.execCommand).toHaveBeenCalledWith('git push origin "chart-app-1.2.3"');
        });
    });

    describe('compareSemver', () => {
        test('should compare semver values correctly', () => {
            expect(chart.compareSemver('1.2.3', '1.2.4')).toBeLessThan(0);
            expect(chart.compareSemver('1.3.0', '1.2.9')).toBeGreaterThan(0);
            expect(chart.compareSemver('1.2.3', '1.2.3')).toBe(0);
            expect(chart.compareSemver('1.2.3-alpha.1', '1.2.3')).toBeLessThan(0);
        });
    });

    describe('getLatestRemoteChartVersion', () => {
        test('should resolve max version from remote tags', () => {
            childProcess.execSync.mockReturnValue([
                '111 refs/tags/chart-app-1.2.0',
                '222 refs/tags/chart-app-1.10.0',
                '333 refs/tags/chart-app-1.2.3'
            ].join('\n'));
            expect(chart.getLatestRemoteChartVersion('app')).toBe('1.10.0');
        });

        test('should return null on missing tags', () => {
            childProcess.execSync.mockReturnValue('');
            expect(chart.getLatestRemoteChartVersion('app')).toBeNull();
        });
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
            fs.existsSync.mockImplementation((filePath) => (
                filePath === '/src/app' ||
                filePath === '/src/app/api' ||
                filePath === '/src/pages' ||
                filePath === '/src/pages/api'
            ));

            fs.readdirSync.mockImplementation((dirPath) => {
                if (dirPath === '/src/app') {
                    return [
                        { name: 'api', isDirectory: () => true, isFile: () => false },
                        { name: 'blog', isDirectory: () => true, isFile: () => false },
                        { name: 'page.tsx', isDirectory: () => false, isFile: () => true }
                    ];
                }
                if (dirPath === '/src/app/api') {
                    return [
                        { name: 'users', isDirectory: () => true, isFile: () => false },
                        { name: 'route.ts', isDirectory: () => false, isFile: () => true }
                    ];
                }
                if (dirPath === '/src/app/api/users') {
                    return [
                        { name: 'route.ts', isDirectory: () => false, isFile: () => true }
                    ];
                }
                if (dirPath === '/src/app/blog') {
                    return [
                        { name: 'page.tsx', isDirectory: () => false, isFile: () => true }
                    ];
                }
                if (dirPath === '/src/pages') {
                    return [
                        { name: 'api', isDirectory: () => true, isFile: () => false },
                        { name: 'index.tsx', isDirectory: () => false, isFile: () => true },
                        { name: 'about.tsx', isDirectory: () => false, isFile: () => true },
                        { name: '_app.tsx', isDirectory: () => false, isFile: () => true }
                    ];
                }
                if (dirPath === '/src/pages/api') {
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
            fs.existsSync.mockImplementation((p) => (
                p === '/src/.next/routes-manifest.json' ||
                p === '/src/.next/server/app-path-routes-manifest.json' ||
                p === '/src/.next/server/pages-manifest.json'
            ));
            fs.readFileSync.mockImplementation((p) => {
                if (p.endsWith('app-path-routes-manifest.json')) {
                    return JSON.stringify({ '/app/api/users': '/api/users', '/app/page': '/' });
                }
                if (p.endsWith('pages-manifest.json')) {
                    return JSON.stringify({ '/api/health': 'x', '/': 'x', '/_app': 'x' });
                }
                if (p.endsWith('routes-manifest.json')) {
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

    describe('chartDeploy', () => {
        test('should call shared executor', async () => {
            runCommand.mockResolvedValue(true);
            await expect(chart.chartDeploy()).resolves.toBe(true);
            expect(runCommand).toHaveBeenCalled();
        });

        test('should resolve latest remote version', async () => {
            childProcess.execSync.mockReturnValue('sha refs/tags/chart-app-1.2.3');
            runCommand.mockImplementation(async (spec) => spec.steps[0].run({ chartName: 'app' }));
            await expect(chart.chartDeploy()).resolves.toBe(true);
        });

        test('should fail when no remote chart tags', async () => {
            childProcess.execSync.mockReturnValue('');
            runCommand.mockImplementation(async (spec) => spec.steps[0].run({ chartName: 'app' }));
            await expect(chart.chartDeploy()).resolves.toBe(false);
        });

        test('should update files and skip commit when no updates', async () => {
            fs.readFileSync.mockReturnValue('spec:\n  chart:\n    spec:\n      version: 1.2.3');
            runCommand.mockImplementation(async (spec) => {
                const ctx = { latestChartVersion: '1.2.3', helmReleaseFiles: ['a/helmrelease.yaml'] };
                return spec.steps[1].run(ctx) && spec.steps[2].run(ctx) && spec.steps[3].run(ctx);
            });
            await expect(chart.chartDeploy()).resolves.toBe(true);
        });

        test('should fail commit step on unexpected staged files', async () => {
            utils.execSilent
                .mockReturnValueOnce('already.txt')
                .mockReturnValueOnce('a/helmrelease.yaml');
            runCommand.mockImplementation(async (spec) => {
                const ctx = { updatedFiles: ['a/helmrelease.yaml'] };
                return spec.steps[3].run(ctx);
            });
            await expect(chart.chartDeploy()).resolves.toBe(false);
        });

        test('should pass commit step full flow', async () => {
            utils.execSilent
                .mockReturnValueOnce('')
                .mockReturnValueOnce('a/helmrelease.yaml')
                .mockReturnValueOnce('a/helmrelease.yaml');
            utils.execCommand.mockReturnValue(true);
            runCommand.mockImplementation(async (spec) => {
                const ctx = { updatedFiles: ['a/helmrelease.yaml'] };
                return spec.steps[3].run(ctx);
            });
            await expect(chart.chartDeploy()).resolves.toBe(true);
        });
    });
});
