#!/usr/bin/env node
const fs = require('fs');
const { runCommand } = require('../src/command-executor');

jest.mock('fs');
jest.mock('../src/utils', () => ({
    logSuccess: jest.fn(),
    logError: jest.fn(),
    execSilent: jest.fn(),
    execCommand: jest.fn(),
    getCurrentBranch: jest.fn(),
    getMainBranch: jest.fn()
}));
jest.mock('../src/command-executor', () => ({
    runCommand: jest.fn()
}));

const chart = require('../src/chart');

describe('Chart', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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

    describe('chartVerify', () => {
        test('should call shared executor', async () => {
            runCommand.mockResolvedValue(true);
            await expect(chart.chartVerify('/tmp/source')).resolves.toBe(true);
            expect(runCommand).toHaveBeenCalled();
        });
    });
});
