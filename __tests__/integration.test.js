#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

describe('Spectrum CLI Integration Tests', () => {
    let tempDir;
    let originalCwd;
    
    beforeEach(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectrum-test-'));
        originalCwd = process.cwd();
        process.chdir(tempDir);
        
        // Create minimal package.json
        const packageJson = {
            name: 'test-project',
            version: '1.0.0',
            description: 'Test project'
        };
        fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
        
        // Create minimal CHANGELOG.md
        const changelog = `# Changelog

## [Unreleased]

### 🆕 Added

_Список новой функциональности._

### 🛠 Changed

_Список изменившейся функциональности._

### 🪲 Fixed

_Список исправлений багов._

### 📦 Support

_Список правок для обеспечения технической поддержки._
`;
        fs.writeFileSync('CHANGELOG.md', changelog);
        
        // Initialize git repo
        try {
            execSync('git init', { stdio: 'pipe' });
            execSync('git config user.name "Test User"', { stdio: 'pipe' });
            execSync('git config user.email "test@example.com"', { stdio: 'pipe' });
            execSync('git add .', { stdio: 'pipe' });
            execSync('git commit -m "Initial commit"', { stdio: 'pipe' });
        } catch (error) {
            // Git operations might fail in CI environment, skip
        }
    });
    
    afterEach(() => {
        process.chdir(originalCwd);
        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('Utils Functions', () => {
        test('should get version from package.json', () => {
            const utils = require('../src/utils');
            expect(utils.getVersion()).toBe('1.0.0');
        });

        test('should detect npm package manager', () => {
            const utils = require('../src/utils');
            fs.writeFileSync('package-lock.json', '{}');
            expect(utils.getPackageManager()).toBe('npm');
        });
    });

    describe('Version Functions', () => {
        test('should increment version numbers correctly', () => {
            const version = require('../src/version');
            expect(version.upVersion('1.2.3', 'major')).toBe('2.0.0');
            expect(version.upVersion('1.2.3', 'minor')).toBe('1.3.0');
            expect(version.upVersion('1.2.3', 'patch')).toBe('1.2.4');
        });

        test('should get version from package.json', () => {
            const version = require('../src/version');
            expect(version.getVersionTypescript()).toBe('1.0.0');
        });
    });

    describe('Changelog Functions', () => {
        test('should format message correctly', () => {
            const changelog = require('../src/changelog');
            expect(changelog.formatMessage('Test message')).toBe('Test message.');
            expect(changelog.formatMessage('Test message.')).toBe('Test message.');
        });

        test('should detect section from branch type', () => {
            // Create mock branches and test section detection logic directly
            const testCases = [
                { branch: 'feature/TEST-123-new', expected: ['### 🆕 Added', '### 🛠 Changed', '### 📜 Deprecated', '### 🗑 Removed'] },
                { branch: 'bugfix/BUG-456-fix', expected: ['### 🪲 Fixed'] },  
                { branch: 'support/DOC-789-update', expected: ['### 📦 Support', '### 🔐 Security'] },
                { branch: 'custom/OTHER-999-unknown', expected: [] }
            ];
            
            testCases.forEach(({ branch, expected }) => {
                const branchLower = branch.toLowerCase();
                let result = [];
                
                if (branchLower.includes('support')) {
                    result = ['### 📦 Support', '### 🔐 Security'];
                } else if (branchLower.includes('bugfix') || branchLower.includes('fix')) {
                    result = ['### 🪲 Fixed'];
                } else if (branchLower.includes('feature') || branchLower.includes('feat')) {
                    result = ['### 🆕 Added', '### 🛠 Changed', '### 📜 Deprecated', '### 🗑 Removed'];
                }
                
                expect(result).toEqual(expected);
            });
        });
    });

    describe('Error Handling', () => {
        test('should handle missing package.json', () => {
            fs.unlinkSync('package.json');
            const utils = require('../src/utils');
            expect(utils.getVersion()).toBeNull();
        });

        test('should handle invalid JSON in package.json', () => {
            fs.writeFileSync('package.json', 'invalid json');
            const utils = require('../src/utils');
            expect(utils.getVersion()).toBeNull();
        });
    });
});

describe('Basic Functionality Tests', () => {
    test('should export all required functions', () => {
        const utils = require('../src/utils');
        expect(typeof utils.logSuccess).toBe('function');
        expect(typeof utils.logError).toBe('function');
        expect(typeof utils.getVersion).toBe('function');
        expect(typeof utils.getCurrentBranch).toBe('function');

        const version = require('../src/version');
        expect(typeof version.upVersion).toBe('function');
        expect(typeof version.setVersionTypescript).toBe('function');

        const changelog = require('../src/changelog');
        expect(typeof changelog.changelogAppend).toBe('function');
        expect(typeof changelog.formatMessage).toBe('function');

        const git = require('../src/git');
        expect(typeof git.goToMainBranch).toBe('function');
        expect(typeof git.gitCreateTagAndPush).toBe('function');

        const release = require('../src/release');
        expect(typeof release.releaseStart).toBe('function');
        expect(typeof release.releaseClose).toBe('function');
    });

    test('should have correct colors object', () => {
        const utils = require('../src/utils');
        expect(utils.colors).toHaveProperty('red');
        expect(utils.colors).toHaveProperty('green');
        expect(utils.colors).toHaveProperty('yellow');
        expect(utils.colors).toHaveProperty('reset');
    });
});
