#!/usr/bin/env node
const fs = require('fs');
const { execSync } = require('child_process');
const utils = require('../src/utils');

// Mock fs and execSync
jest.mock('fs');
jest.mock('child_process');

describe('Utils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Suppress console.log output during tests
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        console.log.mockRestore();
        console.error.mockRestore();
    });

    describe('colors', () => {
        test('should have all required colors', () => {
            expect(utils.colors).toHaveProperty('red');
            expect(utils.colors).toHaveProperty('green');
            expect(utils.colors).toHaveProperty('yellow');
            expect(utils.colors).toHaveProperty('blue');
            expect(utils.colors).toHaveProperty('reset');
        });
    });

    describe('log', () => {
        test('should log message with emoji', () => {
            utils.log('🚀', 'Test message', utils.colors.green);
            expect(console.log).toHaveBeenCalledWith(' 🚀 Test message');
        });
    });

    describe('logSuccess', () => {
        test('should log success message in green', () => {
            utils.logSuccess('✅', 'Success message');
            expect(console.log).toHaveBeenCalledWith(` ✅ ${utils.colors.green}Success message${utils.colors.reset}`);
        });
    });

    describe('logError', () => {
        test('should log error message in red', () => {
            utils.logError('❌', 'Error message');
            expect(console.log).toHaveBeenCalledWith(` ❌ ${utils.colors.red}Error message${utils.colors.reset}`);
        });
    });

    describe('execSilent', () => {
        test('should return trimmed output on success', () => {
            execSync.mockReturnValue('  test output  ');
            const result = utils.execSilent('test command');
            expect(result).toBe('test output');
            expect(execSync).toHaveBeenCalledWith('test command', { stdio: 'pipe', encoding: 'utf8' });
        });

        test('should return null on error', () => {
            execSync.mockImplementation(() => {
                throw new Error('Command failed');
            });
            const result = utils.execSilent('failing command');
            expect(result).toBeNull();
        });
    });

    describe('execCommand', () => {
        test('should return true on success', () => {
            execSync.mockReturnValue('success');
            const result = utils.execCommand('test command');
            expect(result).toBe(true);
            expect(execSync).toHaveBeenCalledWith('test command', { stdio: 'pipe' });
        });

        test('should return false on error', () => {
            execSync.mockImplementation(() => {
                throw new Error('Command failed');
            });
            const result = utils.execCommand('failing command');
            expect(result).toBe(false);
        });

        test('should log error message if provided', () => {
            execSync.mockImplementation(() => {
                throw new Error('Command failed');
            });
            utils.execCommand('failing command', null, 'Custom error');
            expect(console.error).toHaveBeenCalledWith('Custom error');
        });
    });

    describe('getCurrentBranch', () => {
        test('should return current branch name', () => {
            execSync.mockReturnValue('  feature/test-branch  ');
            const result = utils.getCurrentBranch();
            expect(result).toBe('feature/test-branch');
            expect(execSync).toHaveBeenCalledWith('git branch --show-current', { stdio: 'pipe', encoding: 'utf8' });
        });

        test('should return null if git command fails', () => {
            execSync.mockImplementation(() => {
                throw new Error('Not a git repository');
            });
            const result = utils.getCurrentBranch();
            expect(result).toBeNull();
        });
    });

    describe('getMainBranch', () => {
        test('should return "master" if master branch exists', () => {
            execSync.mockReturnValue('origin/master\norigin/develop');
            const result = utils.getMainBranch();
            expect(result).toBe('master');
        });

        test('should return "main" if master branch does not exist', () => {
            execSync.mockReturnValue('origin/main\norigin/develop');
            const result = utils.getMainBranch();
            expect(result).toBe('main');
        });

        test('should return "main" if git command fails', () => {
            execSync.mockImplementation(() => {
                throw new Error('Git command failed');
            });
            const result = utils.getMainBranch();
            expect(result).toBe('main');
        });
    });

    describe('getDevelopBranch', () => {
        test('should return "develop" if develop branch exists', () => {
            execSync.mockReturnValue('origin/main\norigin/develop');
            const result = utils.getDevelopBranch();
            expect(result).toBe('develop');
        });

        test('should return "dev" if develop branch does not exist', () => {
            execSync.mockReturnValue('origin/main\norigin/dev');
            const result = utils.getDevelopBranch();
            expect(result).toBe('dev');
        });

        test('should return "dev" if git command fails', () => {
            execSync.mockImplementation(() => {
                throw new Error('Git command failed');
            });
            const result = utils.getDevelopBranch();
            expect(result).toBe('dev');
        });
    });

    describe('getPackageManager', () => {
        test('should return "npm" if package-lock.json exists', () => {
            fs.existsSync.mockImplementation((file) => file === 'package-lock.json');
            const result = utils.getPackageManager();
            expect(result).toBe('npm');
        });

        test('should return "yarn" if yarn.lock exists', () => {
            fs.existsSync.mockImplementation((file) => file === 'yarn.lock');
            const result = utils.getPackageManager();
            expect(result).toBe('yarn');
        });

        test('should return "bun" if bun.lockb exists', () => {
            fs.existsSync.mockImplementation((file) => file === 'bun.lockb');
            const result = utils.getPackageManager();
            expect(result).toBe('bun');
        });

        test('should return null if no lock file exists', () => {
            fs.existsSync.mockReturnValue(false);
            const result = utils.getPackageManager();
            expect(result).toBeNull();
        });
    });

    describe('getVersion', () => {
        test('should return version from package.json', () => {
            fs.readFileSync.mockReturnValue('{"version": "1.2.3"}');
            const result = utils.getVersion();
            expect(result).toBe('1.2.3');
            expect(fs.readFileSync).toHaveBeenCalledWith('package.json', 'utf8');
        });

        test('should return null if package.json does not exist', () => {
            fs.readFileSync.mockImplementation(() => {
                throw new Error('File not found');
            });
            const result = utils.getVersion();
            expect(result).toBeNull();
        });

        test('should return null if package.json is invalid JSON', () => {
            fs.readFileSync.mockReturnValue('invalid json');
            const result = utils.getVersion();
            expect(result).toBeNull();
        });
    });
});
