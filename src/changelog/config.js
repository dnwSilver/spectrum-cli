#!/usr/bin/env node

const CHANGELOG_FILE = 'CHANGELOG.md';
const CHANGELOG_DIR = '.changelog';

const FRAGMENT_TYPES = Object.freeze({
    breaking: Object.freeze({ section: '### 💥 Breaking change', bump: 'major' }),
    added: Object.freeze({ section: '### 🆕 Added', bump: 'minor' }),
    changed: Object.freeze({ section: '### 🛠 Changed', bump: 'patch' }),
    deprecated: Object.freeze({ section: '### 📜 Deprecated', bump: 'patch' }),
    removed: Object.freeze({ section: '### 🗑 Removed', bump: 'patch' }),
    fixed: Object.freeze({ section: '### 🪲 Fixed', bump: 'patch' }),
    security: Object.freeze({ section: '### 🔐 Security', bump: 'patch' }),
    support: Object.freeze({ section: '### 📦 Support', bump: 'patch' })
});

const SECTION_TO_TYPE = Object.freeze(
    Object.fromEntries(Object.entries(FRAGMENT_TYPES).map(([type, config]) => [config.section, type]))
);

const FRAGMENT_TYPE_PATTERN = Object.keys(FRAGMENT_TYPES).join('|');
const FRAGMENT_FILE_PATTERN = new RegExp(`^(.+)\\.(${FRAGMENT_TYPE_PATTERN})\\.md$`);

function getFragmentType(filePath) {
    const normalizedPath = String(filePath || '').replace(/\\/g, '/');
    const fileName = normalizedPath.split('/').pop();
    const match = fileName.match(FRAGMENT_FILE_PATTERN);
    return match ? match[2] : null;
}

module.exports = {
    CHANGELOG_FILE,
    CHANGELOG_DIR,
    FRAGMENT_TYPES,
    SECTION_TO_TYPE,
    FRAGMENT_FILE_PATTERN,
    getFragmentType
};
