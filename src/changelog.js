#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { logSuccess, logError, execCommand, execSilent, getVersion, getCurrentBranch, colors } = require('./utils');

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

function createReadlineInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

function askQuestion(question) {
    return new Promise((resolve) => {
        const rl = createReadlineInterface();
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function extractTaskFromBranch() {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        logError('❌', 'Cannot get current branch name.');
        return null;
    }
    
    const taskMatch = currentBranch.match(/([a-zA-Z]+-[0-9]+)/);
    if (!taskMatch) {
        console.log(`⚠️  ${colors.yellow}Branch name "${currentBranch}" does not contain task number in format [a-zA-Z]+-[0-9]+.${colors.reset}`);
        const task = await askQuestion('📝 Please enter task number (e.g. SPEC-123): ');
        if (!task || !task.match(/^[a-zA-Z]+-[0-9]+$/)) {
            logError('❌', 'Invalid task format. Expected format: [a-zA-Z]+-[0-9]+');
            return null;
        }
        return task;
    }
    
    return taskMatch[1];
}

async function getGitUser() {
    let name = execSilent('git config user.name');
    let email = execSilent('git config user.email');
    
    if (!name || !email) {
        console.log(`⚠️  ${colors.yellow}Git user name and email are not configured.${colors.reset}`);
        console.log(`💡 You can configure them using:`);
        console.log(`   git config user.name "Your Name"`);
        console.log(`   git config user.email "your.email@domain.com"`);
        console.log('');
        
        if (!name) {
            name = await askQuestion('👤 Please enter your name: ');
            if (!name) {
                logError('❌', 'Name is required.');
                return null;
            }
        }
        
        if (!email) {
            email = await askQuestion('📧 Please enter your email: ');
            if (!email || !email.includes('@')) {
                logError('❌', 'Valid email is required.');
                return null;
            }
        }
    }
    
    return `[${name}](${email})`;
}

function formatMessage(message) {
    if (!message.endsWith('.')) {
        return message + '.';
    }
    return message;
}

function detectSectionFromBranch() {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) return [];
    
    const branchLower = currentBranch.toLowerCase();
    const sections = {
        support: ['### 📦 Support', '### 🔐 Security'],
        bugfix: ['### 🪲 Fixed'],
        feature: ['### 🆕 Added', '### 🛠 Changed', '### 📜 Deprecated', '### 🗑 Removed']
    };
    
    if (branchLower.includes('support')) {
        return sections.support;
    } else if (branchLower.includes('bugfix') || branchLower.includes('fix')) {
        return sections.bugfix;
    } else if (branchLower.includes('feature') || branchLower.includes('feat')) {
        return sections.feature;
    }
    
    return [];
}

async function selectSection(availableSections) {
    if (availableSections.length === 0) {
        availableSections = [
            '### 🆕 Added',
            '### 🛠 Changed', 
            '### 📜 Deprecated',
            '### 🗑 Removed',
            '### 🪲 Fixed',
            '### 🔐 Security',
            '### 📦 Support'
        ];
    }
    
    if (availableSections.length === 1) {
        return availableSections[0];
    }
    
    console.log(`\n📋 Please select a section:`);
    availableSections.forEach((section, index) => {
        console.log(`   ${index + 1}. ${section}`);
    });
    
    const choice = await askQuestion('\n🔢 Enter section number: ');
    const choiceNum = parseInt(choice);
    
    if (isNaN(choiceNum) || choiceNum < 1 || choiceNum > availableSections.length) {
        logError('❌', 'Invalid choice.');
        return null;
    }
    
    return availableSections[choiceNum - 1];
}

function displayContext(lines, insertIndex, entry) {
    console.log('\n📝 Changelog updated:');
    
    if (insertIndex > 0) {
        console.log(`   ${colors.reset}${lines[insertIndex - 1]}${colors.reset}`);
    }
    
    console.log(`   ${colors.green}${entry}${colors.reset}`);
    
    if (insertIndex < lines.length - 1) {
        console.log(`   ${colors.reset}${lines[insertIndex]}${colors.reset}`);
    }
    console.log('');
}

async function changelogAppend(message) {
    try {
        const task = await extractTaskFromBranch();
        if (!task) return false;
        
        const user = await getGitUser();
        if (!user) return false;
        
        const formattedMessage = formatMessage(message);
        const entry = `- ${task} ${formattedMessage} ${user}`;
        
        const availableSections = detectSectionFromBranch();
        const selectedSection = await selectSection(availableSections);
        if (!selectedSection) return false;
        
        const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
        const lines = changelog.split('\n');
        
        let sectionIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === selectedSection) {
                sectionIndex = i;
                break;
            }
        }
        
        if (sectionIndex === -1) {
            logError('❌', `Cannot find "${selectedSection}" section in CHANGELOG.md.`);
            return false;
        }
        
        let insertIndex = sectionIndex + 2;
        let defaultTextLines = 0;
        
        // Count and remember default text lines to remove them
        while (insertIndex + defaultTextLines < lines.length && 
               lines[insertIndex + defaultTextLines].startsWith('_')) {
            defaultTextLines++;
        }
        
        // Insert the new entry
        lines.splice(insertIndex, 0, entry);
        
        // Remove default text lines if this is the first real entry in the section
        if (defaultTextLines > 0) {
            // Check if there are any non-default entries after our insertion
            let hasOtherEntries = false;
            for (let i = insertIndex + 1; i < insertIndex + 1 + defaultTextLines; i++) {
                if (lines[i] && lines[i].startsWith('- ')) {
                    hasOtherEntries = true;
                    break;
                }
            }
            
            // If no other entries, remove default text
            if (!hasOtherEntries) {
                lines.splice(insertIndex + 1, defaultTextLines);
            }
        }
        
        const updatedChangelog = lines.join('\n');
        fs.writeFileSync('CHANGELOG.md', updatedChangelog);
        
        displayContext(lines, insertIndex, entry);
        logSuccess('✅', `Entry added to ${selectedSection}`);
        return true;
    } catch (error) {
        logError('❌', `Error adding changelog entry: ${error.message}`);
        return false;
    }
}


module.exports = {
    changelogChangeHeader,
    changelogRemoveEmptyChapters,
    changelogAddUnreleasedBlock,
    changelogCommit,
    changelogAppend,
    extractTaskFromBranch,
    getGitUser,
    formatMessage,
    detectSectionFromBranch,
    selectSection
};
