const fs = require('fs');
const path = require('path');
const { ok, fail, toPosixPath } = require('./result');

function findValuesYamlFiles(baseDir = 'charts') {
    if (!fs.existsSync(baseDir)) {
        return [];
    }

    const stack = [baseDir];
    const files = [];

    while (stack.length > 0) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (error) {
            return [];
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }

            if (entry.isFile() && entry.name === 'values.yaml') {
                files.push(toPosixPath(fullPath));
            }
        }
    }

    return files.sort();
}

function findHelmReleaseFiles(baseDir = '.') {
    if (!fs.existsSync(baseDir)) {
        return [];
    }

    const skipDirs = new Set(['.git', 'node_modules']);
    const stack = [baseDir];
    const files = [];

    while (stack.length > 0) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (error) {
            return [];
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!skipDirs.has(entry.name)) {
                    stack.push(fullPath);
                }
                continue;
            }

            if (entry.isFile() && entry.name.toLowerCase() === 'helmrelease.yaml') {
                files.push(toPosixPath(fullPath));
            }
        }
    }

    return files.sort();
}

function requireHelmReleaseFiles() {
    const helmReleaseFiles = findHelmReleaseFiles('.');
    if (helmReleaseFiles.length === 0) {
        return fail('Не удалось найти файлы helmrelease.yaml в репозитории.');
    }
    return ok({ helmReleaseFiles });
}

function requireSingleValuesYaml() {
    const valuesFiles = findValuesYamlFiles('charts');
    if (valuesFiles.length === 0) {
        return fail('Не удалось найти values.yaml по маске charts/**/values.yaml.');
    }
    if (valuesFiles.length > 1) {
        return fail(`Найдено несколько файлов values.yaml: ${valuesFiles.join(', ')}.`);
    }
    return ok({ valuesYamlPath: valuesFiles[0] });
}

function extractYamlList(content, sectionName) {
    const lines = String(content || '').split('\n');
    let inIngress = false;
    let inPaths = false;
    let inSection = false;
    let ingressIndent = 0;
    let pathsIndent = 0;
    let sectionIndent = 0;
    const values = [];

    for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        const indent = line.match(/^\s*/)[0].length;
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        if (/^ingress:\s*(#.*)?$/.test(trimmed)) {
            inIngress = true;
            inPaths = false;
            inSection = false;
            ingressIndent = indent;
            continue;
        }

        if (inIngress && indent <= ingressIndent && !/^ingress:\s*(#.*)?$/.test(trimmed)) {
            inIngress = false;
            inPaths = false;
            inSection = false;
        }

        if (!inIngress) {
            continue;
        }

        if (/^paths:\s*(#.*)?$/.test(trimmed)) {
            inPaths = true;
            inSection = false;
            pathsIndent = indent;
            continue;
        }

        if (inPaths && indent <= pathsIndent && !/^paths:\s*(#.*)?$/.test(trimmed)) {
            inPaths = false;
            inSection = false;
        }

        if (!inPaths) {
            continue;
        }

        const sectionRegex = new RegExp(`^${sectionName}:\\s*(#.*)?$`);
        if (sectionRegex.test(trimmed)) {
            inSection = true;
            sectionIndent = indent;
            continue;
        }

        if (inSection && indent <= sectionIndent && !sectionRegex.test(trimmed)) {
            inSection = false;
        }

        if (!inSection) {
            continue;
        }

        const itemMatch = line.match(/^\s*-\s+(.+?)(?:\s+#.*)?$/);
        if (itemMatch) {
            values.push(itemMatch[1].trim());
        }
    }

    return values;
}

function requireIngressPathSections(valuesYamlPath) {
    if (!valuesYamlPath || !fs.existsSync(valuesYamlPath)) {
        return fail(`Обязательный файл "${valuesYamlPath}" не существует.`);
    }

    let content = '';
    try {
        content = fs.readFileSync(valuesYamlPath, 'utf8');
    } catch (error) {
        return fail(`Не удалось прочитать "${valuesYamlPath}".`);
    }

    const api = extractYamlList(content, 'api');
    const pages = extractYamlList(content, 'pages');
    const assets = extractYamlList(content, 'assets');

    if (api.length === 0) {
        return fail(`Отсутствует или пуст ingress.paths.api в "${valuesYamlPath}".`);
    }
    if (pages.length === 0) {
        return fail(`Отсутствует или пуст ingress.paths.pages в "${valuesYamlPath}".`);
    }
    if (assets.length === 0) {
        return fail(`Отсутствует или пуст ingress.paths.assets в "${valuesYamlPath}".`);
    }

    return ok({
        valuesIngressPaths: { api, pages, assets }
    });
}

module.exports = { findValuesYamlFiles, findHelmReleaseFiles, requireHelmReleaseFiles, requireSingleValuesYaml, extractYamlList, requireIngressPathSections };
