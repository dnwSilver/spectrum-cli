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

describe('Chart start', () => {
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

    describe('chartStart', () => {
        test('should call shared executor', async () => {
            runCommand.mockResolvedValue(true);
            await expect(chart.chartStart()).resolves.toBe(true);
            expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({ name: 'chart start' }));
        });

        test('should resolve version from chart changelog before tag and registry checks', async () => {
            runCommand.mockImplementation(async (spec) => spec.checks.map((item) => item.name));
            const checks = await chart.chartStart();
            expect(checks.indexOf('chart-changelog-version')).toBeLessThan(checks.indexOf('tag-missing'));
            expect(checks.indexOf('chart-changelog-version')).toBeLessThan(checks.indexOf('registry-version-missing'));
        });

        test('should execute create and push steps', async () => {
            utils.execCommand.mockReturnValue(true);
            runCommand.mockImplementation(async (spec) => {
                const ctx = { chartName: 'app', version: '1.2.3' };
                return spec.steps[0].run(ctx) && spec.steps[1].run(ctx);
            });
            await expect(chart.chartStart()).resolves.toBe(true);
            expect(utils.execCommand).toHaveBeenCalledWith('git tag "chart-app-1.2.3"');
            expect(utils.execCommand).toHaveBeenCalledWith('git push origin "chart-app-1.2.3"');
        });

        test('should use the top chart changelog version through preflight and tag creation', async () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('## 🚀 [1.2.4] - 2026-10-01\n\n## [1.2.3]\n');
            utils.execSilent.mockReturnValue('');
            utils.execCommand.mockReturnValue(true);
            utils.getRemoteUrl.mockReturnValue('https://gitlab.example.com/group/project');
            process.env.SC_OWNER_PAT = 'secret';
            global.fetch = jest.fn().mockResolvedValue({
                ok: true, status: 200,
                text: async () => 'entries:\n  app:\n    - version: 1.2.3\n'
            });
            runCommand.mockImplementation(async (spec) =>
                jest.requireActual('../../src/cli/command-executor').runCommand({
                    ...spec,
                    context: { chartName: 'app', chartFilePath: 'charts/app/Chart.yaml' },
                    checks: spec.checks.filter((item) =>
                        ['chart-changelog-version', 'tag-missing', 'registry-version-missing'].includes(item.name))
                }));

            await expect(chart.chartStart({ wait: false })).resolves.toBe(true);
            expect(utils.execSilent).toHaveBeenCalledWith('git tag -l "chart-app-1.2.4"');
            expect(utils.execCommand).toHaveBeenCalledWith('git tag "chart-app-1.2.4"');
            expect(utils.execCommand).toHaveBeenCalledWith('git push origin "chart-app-1.2.4"');
        });

        test('should fail downgrade check when version is not greater', async () => {
            childProcess.execSync.mockReturnValue('sha refs/tags/chart-app-1.2.3');
            runCommand.mockImplementation(async (spec) => spec.checks
                .find((item) => item.name === 'version-not-downgrade')
                .run({ chartName: 'app', version: '1.2.2' }));
            const result = await chart.chartStart();
            expect(result.ok).toBe(false);
            expect(result.reason).toContain('--force');
        });

        test('should pass downgrade check when version is greater', async () => {
            childProcess.execSync.mockReturnValue('sha refs/tags/chart-app-1.2.3');
            runCommand.mockImplementation(async (spec) => spec.checks
                .find((item) => item.name === 'version-not-downgrade')
                .run({ chartName: 'app', version: '1.2.4' }));
            await expect(chart.chartStart()).resolves.toEqual({
                ok: true,
                data: { latestChartVersion: '1.2.3' }
            });
        });

        test('should pass downgrade check when no remote tags exist', async () => {
            childProcess.execSync.mockReturnValue('');
            runCommand.mockImplementation(async (spec) => spec.checks
                .find((item) => item.name === 'version-not-downgrade')
                .run({ chartName: 'app', version: '0.0.1' }));
            await expect(chart.chartStart()).resolves.toEqual({ ok: true });
        });

        test('should allow downgrade with force option', async () => {
            childProcess.execSync.mockReturnValue('sha refs/tags/chart-app-1.2.3');
            runCommand.mockImplementation(async (spec) => spec.checks
                .find((item) => item.name === 'version-not-downgrade')
                .run({ chartName: 'app', version: '1.2.2' }));
            await expect(chart.chartStart({ force: true })).resolves.toEqual({
                ok: true,
                data: { latestChartVersion: '1.2.3' }
            });
        });

        test('should wait by default and skip waiting with no-wait', async () => {
            runCommand.mockImplementation(async (spec) => spec.steps.some((item) => item.name === 'wait-for-registry'));
            await expect(chart.chartStart()).resolves.toBe(true);
            await expect(chart.chartStart({ wait: false })).resolves.toBe(false);
        });

        test('should reject a version already in Helm-registry even with --force', async () => {
            utils.getRemoteUrl.mockReturnValue('https://gitlab.example.com/group/project');
            process.env.SC_OWNER_PAT = 'secret';
            global.fetch = jest.fn().mockResolvedValue({
                ok: true, status: 200,
                text: async () => 'entries:\n  app:\n    - version: 1.2.3\n'
            });
            utils.execSilent.mockReturnValue('');
            runCommand.mockImplementation(async (spec) =>
                jest.requireActual('../../src/cli/command-executor').runCommand({
                    ...spec,
                    context: { chartName: 'app', version: '1.2.3' },
                    checks: spec.checks.filter((item) => ['tag-missing', 'registry-version-missing'].includes(item.name))
                }));

            const result = await chart.chartStart({ force: true });
            expect(result).toBe(false);
            expect(utils.logError).toHaveBeenCalledWith(
                '❌', 'Предпроверка не пройдена (%s): %s',
                'registry-version-missing', expect.stringContaining('уже опубликована')
            );
            expect(utils.execCommand).not.toHaveBeenCalled();
        });

        test('should check registry but not push when chart tag exists on origin', async () => {
            utils.execSilent.mockReturnValueOnce('').mockReturnValueOnce('sha refs/tags/chart-app-1.2.3');
            global.fetch = jest.fn();
            runCommand.mockImplementation(async (spec) =>
                jest.requireActual('../../src/cli/command-executor').runCommand({
                    ...spec,
                    context: { chartName: 'app', version: '1.2.3' },
                    checks: spec.checks.filter((item) => ['tag-missing', 'registry-version-missing'].includes(item.name))
                }));

            await expect(chart.chartStart()).resolves.toBe(false);
            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(utils.execCommand).not.toHaveBeenCalled();
        });

        test('should accept a version absent from Helm-registry', async () => {
            utils.getRemoteUrl.mockReturnValue('https://gitlab.example.com/group/project');
            process.env.SC_OWNER_PAT = 'secret';
            global.fetch = jest.fn().mockResolvedValue({
                ok: true, status: 200,
                text: async () => 'entries:\n  app:\n    - version: 1.2.2\n'
            });
            runCommand.mockImplementation(async (spec) => spec.checks
                .find((item) => item.name === 'registry-version-missing')
                .run({ chartName: 'app', version: '1.2.3' }));

            await expect(chart.chartStart()).resolves.toEqual({ ok: true });
        });

        test('should fail closed when Helm-registry cannot be checked', async () => {
            utils.getRemoteUrl.mockReturnValue('https://gitlab.example.com/group/project');
            delete process.env.SC_OWNER_PAT;
            runCommand.mockImplementation(async (spec) => spec.checks
                .find((item) => item.name === 'registry-version-missing')
                .run({ chartName: 'app', version: '1.2.3' }));

            const result = await chart.chartStart();
            expect(result.ok).toBe(false);
            expect(result.reason).toContain('SC_OWNER_PAT');
        });
    });

});
