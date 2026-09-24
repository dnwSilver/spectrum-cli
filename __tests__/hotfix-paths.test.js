jest.mock('fs', () => ({ ...jest.requireActual('fs'), realpathSync: jest.fn() }));
jest.mock('path', () => ({ ...jest.requireActual('path'), relative: jest.fn() }));
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execFileSync: jest.fn() }));
jest.mock('../src/utils', () => ({ ...jest.requireActual('../src/utils'), logError: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { logError } = require('../src/utils');
const { hotfixStart, hotfixDeploy, hotfixClose } = require('../src/hotfix');

describe.each([hotfixStart, hotfixDeploy, hotfixClose])('%p repository root check', (command) => {
    beforeEach(() => {
        jest.clearAllMocks();
        execFileSync.mockImplementation((executable, args) => {
            if (args.join(' ') === 'rev-parse --show-toplevel') return 'c:/Users/runner/work\n';
            // Reaching this branch error proves that the root check accepted the path.
            if (args.join(' ') === 'branch --show-current') return 'dev\n';
            throw new Error('Unexpected Git operation');
        });
    });

    test.each([
        ['c:\\Users\\runner\\work', 'C:\\Users\\runner\\work'],
        ['C:/Users/runner/work', 'C:\\Users\\runner\\work'],
        ['C:\\Users\\Runner\\work', 'c:\\users\\runner\\work'],
    ])('accepts equivalent Windows roots %s and %s', (root, cwd) => {
        path.relative.mockImplementation(path.win32.relative);
        fs.realpathSync.mockReturnValueOnce(root).mockReturnValueOnce(cwd);
        expect(command()).toBe(false);
        expect(logError).toHaveBeenCalledWith('❌', expect.stringContaining('только на hotfix/*, main или master'));
        expect(execFileSync).toHaveBeenCalledTimes(2);
    });

    test.each([
        [path.win32, 'C:\\repo', 'C:\\repo\\nested'],
        [path.win32, 'C:\\repo', 'D:\\repo'],
        [path.posix, '/repo', '/repo/nested'],
        [path.posix, '/Repo', '/repo'],
    ])('rejects distinct roots with native path semantics', (platformPath, root, cwd) => {
        path.relative.mockImplementation(platformPath.relative);
        fs.realpathSync.mockReturnValueOnce(root).mockReturnValueOnce(cwd);
        expect(command()).toBe(false);
        expect(logError).toHaveBeenCalledWith('❌', 'Запустите hotfix из корня репозитория.');
        expect(execFileSync).toHaveBeenCalledTimes(1);
    });
});
