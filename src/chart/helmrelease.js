const fs = require('fs');
const { colors } = require('../common/utils');
const { normalizeList } = require('./routes');
function getInstanceName(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const match = normalized.match(/(?:^|\/)instances\/([^/]+)\/helmrelease\.yaml$/i);
    return match ? match[1] : null;
}

function parseInstancesOption(raw) {
    return normalizeList(String(raw || '').split(','));
}

function updateHelmReleaseVersion(filePath, nextVersion) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const keyStack = [];
    const oldVersions = [];
    let changed = false;

    const updatedLines = lines.map((line) => {
        const keyMatch = line.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
        if (!keyMatch || line.trim().startsWith('#')) {
            return line;
        }

        const indent = keyMatch[1].length;
        const key = keyMatch[2];

        while (keyStack.length > 0 && keyStack[keyStack.length - 1].indent >= indent) {
            keyStack.pop();
        }

        const parentPath = keyStack.map((item) => item.key).join('.');
        keyStack.push({ key, indent });
        if (!(parentPath === 'spec.chart.spec' && key === 'version')) {
            return line;
        }

        const valuePart = keyMatch[3];
        const valueMatch = valuePart.match(/^(\s*)(['"]?)([^'"#\s]+)\2(\s*(?:#.*)?)$/);
        if (!valueMatch) {
            return line;
        }

        const oldVersion = valueMatch[3];
        oldVersions.push(oldVersion);
        if (oldVersion === nextVersion) {
            return line;
        }

        changed = true;
        const spacing = valueMatch[1] || ' ';
        return `${keyMatch[1]}version:${spacing}${valueMatch[2]}${nextVersion}${valueMatch[2]}${valueMatch[4]}`;
    });

    if (changed) {
        fs.writeFileSync(filePath, updatedLines.join('\n'));
    }

    const uniqueOld = Array.from(new Set(oldVersions));
    return {
        filePath,
        oldVersion: uniqueOld.length > 0 ? uniqueOld.join(', ') : 'unknown',
        newVersion: nextVersion,
        changed
    };
}

function printDeployChanges(changes) {
    changes.forEach((item) => {
        const icon = item.changed ? '●' : '○';
        const color = item.changed ? colors.green : '\x1b[90m';
        console.log(
            `  ${color}${icon} ${item.filePath}: ${item.oldVersion} -> ${item.newVersion}${colors.reset}`
        );
    });
}

function splitGitNameOnly(output) {
    if (output === null || output === undefined) {
        return null;
    }
    return String(output)
        .split('\n')
        .map((line) => line.trim().replace(/\\/g, '/'))
        .filter(Boolean);
}

module.exports = { getInstanceName, parseInstancesOption, updateHelmReleaseVersion, printDeployChanges, splitGitNameOnly };
