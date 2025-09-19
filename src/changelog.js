#!/usr/bin/env node
const fs = require('fs');
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
        console.log(` ${colors.yellow} ${colors.reset} Update header ${colors.green}🚀 [${currentVersion}]${colors.reset}.`);
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
        
        console.log(` ${colors.yellow} ${colors.reset} Remove empty chapters.`);
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
        
        const unreleased = `## [Unreleased]

### 🆕 Added

_Список новой функциональности._

### 🛠 Changed

_Список изменившейся функциональности._

### 📜 Deprecated

_Список устаревшей функциональности._

### 🗑 Removed

_Список удаленной функциональности._

### 🪲 Fixed

_Список исправлений багов._

### 🔐 Security

_Список правок для обеспечения безопасности._

### 📦 Support

_Список правок для обеспечения технической поддержки._

`;
        
        const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
        const updatedChangelog = changelog.replace(
            new RegExp(`## 🚀 \\[${currentVersion}\\]`),
            `${unreleased}## 🚀 [${currentVersion}]`
        );
        
        fs.writeFileSync('CHANGELOG.md', updatedChangelog);
        console.log(` ${colors.yellow} ${colors.reset} Add unreleased block.`);
        return true;
    } catch (error) {
        return false;
    }
}

function changelogCommit() {
    const addSuccess = execCommand('git add CHANGELOG.md', null, null);
    const commitSuccess = execCommand('git commit --message "📝 Update changelog." --no-verify', null, null);
    
    if (addSuccess && commitSuccess) {
        logSuccess('󰜘', 'Commit updated changelog.');
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
