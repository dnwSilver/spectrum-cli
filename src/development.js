#!/usr/bin/env node
const { getPackageManager, execCommand, logError } = require('./utils');

function dev() {
    const pm = getPackageManager();
    
    switch (pm) {
        case 'npm':
            return execCommand('npm run dev');
        case 'yarn':
            return execCommand('yarn dev');
        case 'bun':
            logError('⚠️', 'Bun not implemented');
            return false;
        default:
            logError('⚠️', 'No package manager found');
            return false;
    }
}

function test() {
    const pm = getPackageManager();
    
    switch (pm) {
        case 'npm':
            return execCommand('NODE_ENV=test npm run dev');
        case 'yarn':
            return execCommand('NODE_ENV=test yarn dev');
        case 'bun':
            logError('⚠️', 'Bun not implemented');
            return false;
        default:
            logError('⚠️', 'No package manager found');
            return false;
    }
}

function deps() {
    const pm = getPackageManager();
    
    switch (pm) {
        case 'npm':
            return execCommand('npm install');
        case 'yarn':
            return execCommand('yarn install');
        case 'bun':
            logError('⚠️', 'Bun not implemented');
            return false;
        default:
            logError('⚠️', 'No package manager found');
            return false;
    }
}

function build() {
    const pm = getPackageManager();
    
    switch (pm) {
        case 'npm':
            return execCommand('npm run build');
        case 'yarn':
            return execCommand('yarn build');
        case 'bun':
            return execCommand('bun run build');
        default:
            logError('⚠️', 'No package manager found');
            return false;
    }
}

function e2e() {
    const pm = getPackageManager();
    
    switch (pm) {
        case 'npm':
            return execCommand('npm run test:e2e');
        case 'yarn':
            return execCommand('yarn test:e2e');
        case 'bun':
            logError('⚠️', 'Bun not implemented');
            return false;
        default:
            logError('⚠️', 'No package manager found');
            return false;
    }
}

function e2eui() {
    const pm = getPackageManager();
    
    switch (pm) {
        case 'npm':
            return execCommand('npm run test:end2end:ui');
        case 'yarn':
            return execCommand('yarn test:e2e --ui');
        case 'bun':
            logError('⚠️', 'Bun not implemented');
            return false;
        default:
            logError('⚠️', 'No package manager found');
            return false;
    }
}


module.exports = {
    dev,
    test,
    deps,
    build,
    e2e,
    e2eui
};
