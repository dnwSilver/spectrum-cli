#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { logSuccess, execCommand, getVersion, colors } = require('./utils');

function changelogChangeHeader() {
    try {
        const currentVersion = getVersion();
        if (!currentVersion) {
            return false;
        }

        const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
        const updatedChangelog = changelog.replace(
            /## \[Unreleased\]/g,
            `## 🚀 [${currentVersion}]`
        );

        fs.writeFileSync('CHANGELOG.md', updatedChangelog);
        logSuccess('🔄', `Update header ${colors.green}🚀 [${currentVersion}]${colors.reset}.`);
        return true;
    } catch (error) {
        return false;
    }
}

function changelogRemoveEmptyChapters() {
    try {
        const data = fs.readFileSync('CHANGELOG.md', 'utf8');
        const updatedData = data.replaceAll(/###.*\n\n_.*_\n\n/gm, '');
        fs.writeFileSync('CHANGELOG.md', updatedData);

        logSuccess('🧹', 'Remove empty chapters.');
        return true;
    } catch (error) {
        return false;
    }
}

function changelogAddUnreleasedBlock() {
    try {
        const currentVersion = getVersion();
        if (!currentVersion) {
            return false;
        }

        const unreleased = fs.readFileSync(path.join(__dirname, 'UNRELEASED.md'), 'utf8') + '\n';

        const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
        const updatedChangelog = changelog.replace(
            new RegExp(`## 🚀 \\[${currentVersion}\\]`),
            `${unreleased}## 🚀 [${currentVersion}]`
        );

        fs.writeFileSync('CHANGELOG.md', updatedChangelog);
        logSuccess('📋', 'Add unreleased block.');
        return true;
    } catch (error) {
        return false;
    }
}

function changelogCommit() {
    const addSuccess = execCommand('git add CHANGELOG.md', null, null);
    const commitSuccess = execCommand('git commit --message "📝 Update changelog." --no-verify', null, null);

    if (addSuccess && commitSuccess) {
        logSuccess('📝', 'Commit updated changelog.');
        return true;
    }
    return false;
}


module.exports = {
    changelogChangeHeader,
    changelogRemoveEmptyChapters,
    changelogAddUnreleasedBlock,
    changelogCommit
};
