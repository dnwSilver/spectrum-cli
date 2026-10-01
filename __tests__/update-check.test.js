const childProcess = require('child_process');
const { version: currentVersion } = require('../package.json');
const { upVersion } = require('../src/common/version');
const { checkForUpdates, upgrade, UPDATE_CHECK_TIMEOUT_MS } = require('../src/cli/update-check');
const { withDryRun } = require('../src/cli/command-executor');

describe('optional CLI update check', () => {
    const originalFetch = global.fetch;
    let log;

    beforeEach(() => {
        log = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('reports a newer published version and the exact upgrade command', async () => {
        const nextVersion = upVersion(currentVersion, 'patch');
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: nextVersion }) });

        await checkForUpdates();

        expect(global.fetch).toHaveBeenCalledWith('https://registry.npmjs.org/spectrum-cli/latest', expect.objectContaining({
            signal: expect.any(AbortSignal)
        }));
        expect(log).toHaveBeenCalledWith(expect.stringContaining(`сейчас ${currentVersion}, доступна ${nextVersion}`));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Обновить: spectrum upgrade'));
    });

    test.each([currentVersion, '0.0.0'])('stays quiet for version %s', async (version) => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version }) });

        await checkForUpdates();

        expect(log).not.toHaveBeenCalled();
    });

    test.each([
        () => Promise.reject(new Error('offline')),
        () => Promise.resolve({ ok: false }),
        () => Promise.resolve({ ok: true, json: async () => ({ version: 'invalid' }) })
    ])('silently ignores a failed check', async (response) => {
        global.fetch = jest.fn().mockImplementation(response);

        await expect(checkForUpdates()).resolves.toBeUndefined();

        expect(log).not.toHaveBeenCalled();
    });

    test('stops waiting after 200 ms even if the request never settles', async () => {
        jest.useFakeTimers();
        global.fetch = jest.fn().mockImplementation(() => new Promise(() => {}));

        const check = checkForUpdates();
        const signal = global.fetch.mock.calls[0][1].signal;
        await jest.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS);
        await expect(check).resolves.toBeUndefined();

        expect(UPDATE_CHECK_TIMEOUT_MS).toBe(200);
        expect(signal.aborted).toBe(true);
        expect(log).not.toHaveBeenCalled();
    });

    test('upgrade runs the global npm install and returns its status', () => {
        const install = jest.spyOn(childProcess, 'spawnSync').mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 1 });

        expect(upgrade()).toBe(true);
        expect(upgrade()).toBe(false);
        expect(install).toHaveBeenCalledWith('npm', ['install', '-g', 'spectrum-cli'], {
            stdio: 'inherit', shell: process.platform === 'win32'
        });
    });

    test('dry upgrade does not run npm', () => {
        const install = jest.spyOn(childProcess, 'spawnSync');
        expect(withDryRun(true, () => upgrade())).toBe(true);
        expect(install).not.toHaveBeenCalled();
    });

    test('upgrade reports an npm launch error to the command wrapper', () => {
        jest.spyOn(childProcess, 'spawnSync').mockReturnValue({ error: new Error('npm missing') });

        expect(upgrade).toThrow('npm missing');
    });
});
