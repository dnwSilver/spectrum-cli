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

describe('Chart metadata', () => {
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

});
