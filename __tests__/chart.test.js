#!/usr/bin/env node
const fs = require('fs');
const {
    logSuccess,
    logError,
    execSilent,
    execCommand,
    getCurrentBranch
} = require('../src/utils');

jest.mock('fs');
jest.mock('../src/utils', () => ({
    logSuccess: jest.fn(),
    logError: jest.fn(),
    execSilent: jest.fn(),
    execCommand: jest.fn(),
    getCurrentBranch: jest.fn()
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
    });

    describe('getChartName', () => {
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
    });

    describe('chartCreateTag', () => {
        test('should fail when current branch is not main', () => {
            getCurrentBranch.mockReturnValue('dev');
            expect(chart.chartCreateTag('1.2.3')).toBe(false);
            expect(logError).toHaveBeenCalled();
        });

        test('should fail when version is not semver', () => {
            getCurrentBranch.mockReturnValue('main');
            expect(chart.chartCreateTag('1.2')).toBe(false);
            expect(logError).toHaveBeenCalledWith('❌', 'Version "%s" is not a valid semver.', '1.2');
        });

        test('should fail when no chart files found', () => {
            getCurrentBranch.mockReturnValue('main');
            fs.existsSync.mockImplementation((filePath) => filePath !== 'charts');

            expect(chart.chartCreateTag('1.2.3')).toBe(false);
            expect(logError).toHaveBeenCalledWith('❌', 'Cannot find Chart.yaml in %s/<chart-name>/Chart.yaml.', 'charts');
        });

        test('should fail when multiple chart files found', () => {
            getCurrentBranch.mockReturnValue('main');
            fs.existsSync.mockImplementation((filePath) => (
                filePath === 'charts' ||
                filePath === 'charts/site-a/Chart.yaml' ||
                filePath === 'charts/site-b/Chart.yaml'
            ));
            fs.readdirSync.mockReturnValue([
                { name: 'site-a', isDirectory: () => true },
                { name: 'site-b', isDirectory: () => true }
            ]);

            expect(chart.chartCreateTag('1.2.3')).toBe(false);
            expect(logError).toHaveBeenCalled();
        });

        test('should fail when tag already exists', () => {
            getCurrentBranch.mockReturnValue('main');
            fs.existsSync.mockImplementation((filePath) => (
                filePath === 'charts' ||
                filePath === 'charts/site-a/Chart.yaml'
            ));
            fs.readdirSync.mockReturnValue([
                { name: 'site-a', isDirectory: () => true }
            ]);
            fs.readFileSync.mockReturnValue('name: site-a\n');
            execSilent.mockReturnValue('chart-site-a-1.2.3');

            expect(chart.chartCreateTag('1.2.3')).toBe(false);
            expect(logError).toHaveBeenCalledWith('❌', 'Tag %s already exists.', 'chart-site-a-1.2.3');
        });

        test('should fail when git tag creation fails', () => {
            getCurrentBranch.mockReturnValue('main');
            fs.existsSync.mockImplementation((filePath) => (
                filePath === 'charts' ||
                filePath === 'charts/site-a/Chart.yaml'
            ));
            fs.readdirSync.mockReturnValue([
                { name: 'site-a', isDirectory: () => true }
            ]);
            fs.readFileSync.mockReturnValue('name: site-a\n');
            execSilent.mockReturnValue('');
            execCommand.mockReturnValue(false);

            expect(chart.chartCreateTag('1.2.3')).toBe(false);
            expect(execCommand).toHaveBeenCalledWith('git tag "chart-site-a-1.2.3"', null, null);
            expect(logError).toHaveBeenCalledWith('❌', 'Cannot create tag %s.', 'chart-site-a-1.2.3');
        });

        test('should fail when git push fails', () => {
            getCurrentBranch.mockReturnValue('main');
            fs.existsSync.mockImplementation((filePath) => (
                filePath === 'charts' ||
                filePath === 'charts/site-a/Chart.yaml'
            ));
            fs.readdirSync.mockReturnValue([
                { name: 'site-a', isDirectory: () => true }
            ]);
            fs.readFileSync.mockReturnValue('name: site-a\n');
            execSilent.mockReturnValue('');
            execCommand.mockReturnValueOnce(true).mockReturnValueOnce(false);

            expect(chart.chartCreateTag('1.2.3')).toBe(false);
            expect(execCommand).toHaveBeenNthCalledWith(1, 'git tag "chart-site-a-1.2.3"', null, null);
            expect(execCommand).toHaveBeenNthCalledWith(2, 'git push origin "chart-site-a-1.2.3"', null, null);
            expect(logError).toHaveBeenCalledWith('❌', 'Cannot push tag %s to origin.', 'chart-site-a-1.2.3');
        });

        test('should create and push tag successfully', () => {
            getCurrentBranch.mockReturnValue('main');
            fs.existsSync.mockImplementation((filePath) => (
                filePath === 'charts' ||
                filePath === 'charts/site-a/Chart.yaml'
            ));
            fs.readdirSync.mockReturnValue([
                { name: 'site-a', isDirectory: () => true }
            ]);
            fs.readFileSync.mockReturnValue('name: site-a\n');
            execSilent.mockReturnValue('');
            execCommand.mockReturnValue(true);

            expect(chart.chartCreateTag('1.2.3')).toBe(true);
            expect(execCommand).toHaveBeenNthCalledWith(1, 'git tag "chart-site-a-1.2.3"', null, null);
            expect(execCommand).toHaveBeenNthCalledWith(2, 'git push origin "chart-site-a-1.2.3"', null, null);
            expect(logSuccess).toHaveBeenCalledWith('🔖', 'Created tag %s.', 'chart-site-a-1.2.3');
            expect(logSuccess).toHaveBeenCalledWith('🚀', 'Pushed tag %s to origin.', 'chart-site-a-1.2.3');
        });
    });
});
