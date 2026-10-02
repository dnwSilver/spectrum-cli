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

describe('Chart registry', () => {
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

    describe('helmIndexHasChartVersion', () => {
        const indexYaml = [
            'apiVersion: v1',
            'entries:',
            '  app:',
            '    - apiVersion: v2',
            '      name: app',
            '      version: 1.2.3',
            '    - apiVersion: v2',
            '      name: app',
            '      version: 1.2.2',
            '  other:',
            '    - name: other',
            '      version: 9.9.9',
            'generated: "2026-08-28T00:00:00Z"'
        ].join('\n');

        test('should find existing chart version', () => {
            expect(chart.helmIndexHasChartVersion(indexYaml, 'app', '1.2.3')).toBe(true);
            expect(chart.helmIndexHasChartVersion(indexYaml, 'app', '1.2.2')).toBe(true);
        });

        test('should not find missing version or foreign chart version', () => {
            expect(chart.helmIndexHasChartVersion(indexYaml, 'app', '9.9.9')).toBe(false);
            expect(chart.helmIndexHasChartVersion(indexYaml, 'other', '1.2.3')).toBe(false);
            expect(chart.helmIndexHasChartVersion('', 'app', '1.2.3')).toBe(false);
        });

        test('should find chart version in GitLab index with non-indented sequences', () => {
            const gitlabIndexYaml = [
                '---',
                'apiVersion: v1',
                'entries:',
                '  app:',
                '  - apiVersion: v2',
                '    name: app',
                '    version: 1.9.0',
                '  - apiVersion: v2',
                '    name: app',
                '    version: 1.8.2',
                '  other:',
                '  - name: other',
                '    version: 9.9.9',
                'generated: "2026-10-02T00:00:00Z"'
            ].join('\n');

            expect(chart.helmIndexHasChartVersion(gitlabIndexYaml, 'app', '1.9.0')).toBe(true);
            expect(chart.helmIndexHasChartVersion(gitlabIndexYaml, 'app', '1.8.2')).toBe(true);
            expect(chart.helmIndexHasChartVersion(gitlabIndexYaml, 'app', '9.9.9')).toBe(false);
            expect(chart.helmIndexHasChartVersion(gitlabIndexYaml, 'other', '1.9.0')).toBe(false);
        });
    });

    describe('fetchChartVersionFromRegistry', () => {
        test('should fail without remote origin url', async () => {
            utils.getRemoteUrl.mockReturnValue(null);
            const result = await chart.fetchChartVersionFromRegistry('app', '1.2.3');
            expect(result.ok).toBe(false);
            expect(result.reason).toContain('origin');
        });

        test('should fail without SC_OWNER_PAT', async () => {
            utils.getRemoteUrl.mockReturnValue('https://gitlab.example.com/group/project');
            delete process.env.SC_OWNER_PAT;
            const result = await chart.fetchChartVersionFromRegistry('app', '1.2.3');
            expect(result.ok).toBe(false);
            expect(result.reason).toContain('SC_OWNER_PAT');
        });

        test('should fail on http error', async () => {
            utils.getRemoteUrl.mockReturnValue('https://gitlab.example.com/group/project');
            process.env.SC_OWNER_PAT = 'secret';
            global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
            const result = await chart.fetchChartVersionFromRegistry('app', '1.2.3');
            expect(result.ok).toBe(false);
            expect(result.reason).toContain('403');
        });

        test('should fail on network error', async () => {
            utils.getRemoteUrl.mockReturnValue('https://gitlab.example.com/group/project');
            process.env.SC_OWNER_PAT = 'secret';
            global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
            const result = await chart.fetchChartVersionFromRegistry('app', '1.2.3');
            expect(result.ok).toBe(false);
            expect(result.reason).toContain('offline');
        });

        test('should report found version', async () => {
            utils.getRemoteUrl.mockReturnValue('https://gitlab.example.com/group/project');
            process.env.SC_OWNER_PAT = 'secret';
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => 'entries:\n  app:\n    - version: 1.2.3\n'
            });
            const result = await chart.fetchChartVersionFromRegistry('app', '1.2.3');
            expect(result).toEqual({
                ok: true,
                found: true,
                indexUrl: 'https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/helm/stable/index.yaml'
            });
        });
    });

    describe('waitForChartInRegistry', () => {
        test('should succeed once version appears', async () => {
            utils.getRemoteUrl.mockReturnValue('https://gitlab.example.com/group/project');
            process.env.SC_OWNER_PAT = 'secret';
            global.fetch = jest.fn()
                .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'entries:\n  app: []\n' })
                .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'entries:\n  app:\n    - version: 1.2.3\n' });

            const sleep = jest.fn().mockResolvedValue(undefined);
            await expect(chart.waitForChartInRegistry('app', '1.2.3', { timeoutMs: 60000, intervalMs: 1, sleep })).resolves.toBe(true);
            expect(sleep).toHaveBeenCalledTimes(1);
        });

        test('should fail on timeout', async () => {
            utils.getRemoteUrl.mockReturnValue('https://gitlab.example.com/group/project');
            process.env.SC_OWNER_PAT = 'secret';
            global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'entries:\n  app: []\n' });

            const sleep = jest.fn().mockResolvedValue(undefined);
            await expect(chart.waitForChartInRegistry('app', '1.2.3', { timeoutMs: 0, intervalMs: 1, sleep })).resolves.toBe(false);
            expect(sleep).not.toHaveBeenCalled();
        });

        test('should fail fast on registry access error', async () => {
            utils.getRemoteUrl.mockReturnValue(null);
            await expect(chart.waitForChartInRegistry('app', '1.2.3', { timeoutMs: 60000, intervalMs: 1 })).resolves.toBe(false);
        });
    });

});
