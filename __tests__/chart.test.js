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
});
