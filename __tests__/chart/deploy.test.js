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

describe('Chart deploy', () => {
    const originalLog = console.log;
    const originalFetch = global.fetch;
    const originalToken = process.env.GITLAB_PRIVATE_TOKEN;
    beforeEach(() => {
        jest.clearAllMocks();
        console.log = jest.fn();
    });
    afterAll(() => {
        console.log = originalLog;
        global.fetch = originalFetch;
        if (originalToken === undefined) {
            delete process.env.GITLAB_PRIVATE_TOKEN;
        } else {
            process.env.GITLAB_PRIVATE_TOKEN = originalToken;
        }
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
                return spec.steps[2].run(ctx) && spec.steps[3].run(ctx) && spec.steps[4].run(ctx);
            });
            await expect(chart.chartDeploy()).resolves.toBe(true);
        });

        test('should fail commit step on unexpected staged files', async () => {
            utils.execSilent
                .mockReturnValueOnce('already.txt')
                .mockReturnValueOnce('a/helmrelease.yaml');
            runCommand.mockImplementation(async (spec) => {
                const ctx = { updatedFiles: ['a/helmrelease.yaml'] };
                return spec.steps[4].run(ctx);
            });
            await expect(chart.chartDeploy()).resolves.toBe(false);
        });

        test('should pass commit step full flow', async () => {
            utils.execSilent
                .mockReturnValueOnce('')
                .mockReturnValueOnce('instances/sd/helmrelease.yaml')
                .mockReturnValueOnce('instances/sd/helmrelease.yaml');
            utils.execCommand.mockReturnValue(true);
            runCommand.mockImplementation(async (spec) => {
                const ctx = {
                    latestChartVersion: '1.2.3',
                    updatedFiles: ['instances/sd/helmrelease.yaml'],
                    updatedInstances: ['sd']
                };
                return spec.steps[4].run(ctx);
            });
            await expect(chart.chartDeploy()).resolves.toBe(true);
            expect(utils.execCommand).toHaveBeenCalledWith('git commit -m "🚀 Деплой сервиса 1.2.3 (sd)."');
        });

        test('should verify chart version in registry before update', async () => {
            utils.getRemoteUrl.mockReturnValue('https://gitlab.example.com/group/project');
            process.env.GITLAB_PRIVATE_TOKEN = 'secret';
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => [
                    'apiVersion: v1',
                    'entries:',
                    '  app:',
                    '    - name: app',
                    '      version: 1.2.3'
                ].join('\n')
            });
            runCommand.mockImplementation(async (spec) => spec.steps[1].run({ chartName: 'app', latestChartVersion: '1.2.3' }));
            await expect(chart.chartDeploy()).resolves.toBe(true);
            expect(global.fetch).toHaveBeenCalledWith(
                'https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/helm/stable/index.yaml',
                { headers: { 'PRIVATE-TOKEN': 'secret' } }
            );
        });

        test('should fail registry step when version is absent', async () => {
            utils.getRemoteUrl.mockReturnValue('https://gitlab.example.com/group/project');
            process.env.GITLAB_PRIVATE_TOKEN = 'secret';
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => 'apiVersion: v1\nentries:\n  app:\n    - version: 1.2.2\n'
            });
            runCommand.mockImplementation(async (spec) => spec.steps[1].run({ chartName: 'app', latestChartVersion: '1.2.3' }));
            await expect(chart.chartDeploy()).resolves.toBe(false);
        });

        test('should filter helmrelease files by instances option', async () => {
            runCommand.mockImplementation(async (spec) => spec.checks
                .find((item) => item.name === 'filter-instances')
                .run({
                    helmReleaseFiles: [
                        'instances/sd/helmrelease.yaml',
                        'instances/ssd/helmrelease.yaml',
                        'instances/cbch/helmrelease.yaml'
                    ]
                }));

            await expect(chart.chartDeploy({ instances: 'sd, cbch' })).resolves.toEqual({
                ok: true,
                data: {
                    helmReleaseFiles: [
                        'instances/sd/helmrelease.yaml',
                        'instances/cbch/helmrelease.yaml'
                    ]
                }
            });
        });

        test('should fail on unknown instance name', async () => {
            runCommand.mockImplementation(async (spec) => spec.checks
                .find((item) => item.name === 'filter-instances')
                .run({ helmReleaseFiles: ['instances/sd/helmrelease.yaml'] }));

            const result = await chart.chartDeploy({ instances: 'nope' });
            expect(result.ok).toBe(false);
            expect(result.reason).toContain('nope');
            expect(result.reason).toContain('sd');
        });

        test('should keep all files when instances option is not set', async () => {
            runCommand.mockImplementation(async (spec) => spec.checks
                .find((item) => item.name === 'filter-instances')
                .run({ helmReleaseFiles: ['instances/sd/helmrelease.yaml'] }));

            await expect(chart.chartDeploy()).resolves.toEqual({ ok: true });
        });

        test('should fail instances option without instances structure', async () => {
            runCommand.mockImplementation(async (spec) => spec.checks
                .find((item) => item.name === 'filter-instances')
                .run({ helmReleaseFiles: ['apps/app/helmrelease.yaml'] }));

            const result = await chart.chartDeploy({ instances: 'sd' });
            expect(result.ok).toBe(false);
        });
    });

    describe('getInstanceName', () => {
        test('should extract instance name from helmrelease path', () => {
            expect(chart.getInstanceName('instances/sd/helmrelease.yaml')).toBe('sd');
            expect(chart.getInstanceName('./instances/scbch/helmrelease.yaml')).toBe('scbch');
            expect(chart.getInstanceName('apps/app/helmrelease.yaml')).toBeNull();
            expect(chart.getInstanceName('')).toBeNull();
        });
    });

    describe('parseInstancesOption', () => {
        test('should split, trim and deduplicate names', () => {
            expect(chart.parseInstancesOption('sd, cbch,sd,,')).toEqual(['sd', 'cbch']);
            expect(chart.parseInstancesOption(undefined)).toEqual([]);
        });
    });

});
