const { runCommand } = require('../cli/command-executor');
const { requireGitRepo, requireFileExists, requirePrettierAvailable, requireChangelogFormatted, requireChangelogFragments } = require('../preflight');
const { CHANGELOG_FILE } = require('./config');
const { prepareChangelogEntry, appendPreparedChangelogEntry } = require('./fragments');
const { writeCurrentChangelog } = require('./format');
function changelogAppend(message) {
    return runCommand({
        name: 'changelog append',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'changelog-exists', run: () => requireFileExists(CHANGELOG_FILE) },
            { name: 'prepare-fragment', dependsOn: ['git-repo', 'changelog-exists'], run: () => prepareChangelogEntry(message) }
        ],
        steps: [
            { name: 'write-fragment', run: appendPreparedChangelogEntry }
        ]
    });
}

function changelogCheck() {
    return runCommand({
        name: 'changelog check',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'changelog-exists', run: () => requireFileExists(CHANGELOG_FILE) },
            { name: 'changelog-prettier-check', run: requireChangelogFormatted },
            { name: 'changelog-fragments', run: requireChangelogFragments }
        ]
    });
}

function changelogWrite() {
    return runCommand({
        name: 'changelog write',
        checks: [
            { name: 'git-repo', run: requireGitRepo },
            { name: 'changelog-exists', run: () => requireFileExists(CHANGELOG_FILE) },
            { name: 'prettier-available', run: requirePrettierAvailable }
        ],
        steps: [{ name: 'write-changelog', run: writeCurrentChangelog }]
    });
}

module.exports = { changelogAppend, changelogCheck, changelogWrite };
