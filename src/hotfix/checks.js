const fs = require('fs');
const path = require('path');
const preflight = require('../preflight');
const { logError } = require('../common/utils');
const { reportPreflight } = require('../cli/command-executor');
const { upVersion, compareVersions } = require('../common/version');
const { STABLE_TAG_PATTERNS, parseStableTag, stableTagNames } = require('../release/stable-tags');
const { git, exists, ancestor, readAt } = require('./git');
function preflightReport(commandName) {
    let failures = 0;
    return {
        check(name, action, description, unavailableReason) {
            if (unavailableReason) {
                logError('❌', 'Предпроверка не выполнена (%s): %s', name, unavailableReason);
                failures += 1;
                return { ok: false };
            }
            try {
                const value = action();
                reportPreflight(commandName, name, typeof description === 'function' ? description(value) : description);
                return { ok: true, value };
            } catch (error) {
                logError('❌', 'Предпроверка не пройдена (%s): %s', name, error?.message || String(error));
                failures += 1;
                return { ok: false };
            }
        },
        get ok() { return failures === 0; }
    };
}

function context(mode, checks) {
    const root = checks.check('repository-root', () => {
        const root = git('rev-parse', '--show-toplevel').trim();
        if (path.relative(fs.realpathSync(root), fs.realpathSync(process.cwd())) !== '') {
            throw new Error('Запустите hotfix из корня репозитория.');
        }
    }, 'команда запущена из корня Git-репозитория');
    const branch = checks.check('branch', () => {
        const branch = git('branch', '--show-current').trim();
        if (!['main', 'master'].includes(branch) && !/^hotfix\/.+/.test(branch)) {
            throw new Error('Hotfix-команды разрешены только на hotfix/*, main или master (не detached HEAD).');
        }
        if (mode !== 'start' && !['main', 'master'].includes(branch)) {
            throw new Error('hotfix deploy/close выполняются на main/master после merge хотфикса.');
        }
        if (mode === 'start' && !['main', 'master'].includes(branch) && !/^hotfix\/[A-Z]+-[0-9]+(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(branch)) {
            throw new Error('hotfix start выполняется на hotfix/<TASK>[-slug], main или master.');
        }
        return branch;
    }, (value) => `ветка ${value} разрешена для этой команды`,
    root.ok ? null : 'не пройдена проверка корня репозитория');
    if (mode !== 'start') checks.check('clean-working-tree', () => {
        if (git('status', '--porcelain').trim()) throw new Error('Для deploy/close требуется чистое рабочее дерево.');
    }, 'рабочее дерево Git чистое', root.ok ? null : 'не пройдена проверка корня репозитория');
    checks.check('merge-conflicts', () => {
        if (git('ls-files', '--unmerged').trim()) throw new Error('Сначала разрешите конфликты Git.');
    }, 'неразрешённых конфликтов Git нет', root.ok ? null : 'не пройдена проверка корня репозитория');
    let productionRef;
    const history = checks.check('production-history', () => {
        git('fetch', 'origin', '--prune', '--tags');
        const mainBranch = ['master', 'main'].find((name) => exists(`refs/remotes/origin/${name}`));
        if (!mainBranch) throw new Error('Не найдена production-ветка origin/main или origin/master.');
        const mainSha = git('rev-parse', `refs/remotes/origin/${mainBranch}`).trim();
        const head = git('rev-parse', 'HEAD').trim();
        productionRef = { mainBranch, mainSha, head };
        if (['main', 'master'].includes(branch.value) && branch.value !== mainBranch) {
            throw new Error(`Production-ветка origin — ${mainBranch}. Переключитесь на неё или на hotfix/<TASK>[-slug].`);
        }
        if (mode === 'start') {
            if (!ancestor(mainSha, head)) throw new Error('Сначала обновите hotfix из актуальной production-ветки.');
        } else if (branch.value !== mainBranch || head !== mainSha) {
            throw new Error(`Нужна ветка ${mainBranch}, точно совпадающая с origin/${mainBranch}.`);
        }
        return { mainBranch, mainSha, head };
    }, (value) => mode === 'start'
        ? `текущая ветка содержит origin/${value.mainBranch}`
        : `текущий commit совпадает с origin/${value.mainBranch}`,
    root.ok && branch.ok ? null : 'не пройдена проверка корня репозитория или ветки');
    const stable = checks.check('stable-version', () => {
        const { mainSha } = productionRef;
        // Query origin explicitly: a local-only tag must never change the baseline.
        const remoteTags = new Map(git('ls-remote', '--refs', '--tags', 'origin', ...STABLE_TAG_PATTERNS.map((tag) => `refs/tags/${tag}`))
            .trim().split('\n').filter(Boolean).map((line) => {
                const [sha, ref] = line.split(/\s+/);
                return [ref.slice('refs/tags/'.length), sha];
            }));
        const versions = git('tag', '--merged', mainSha, '--list', ...STABLE_TAG_PATTERNS).trim().split('\n')
            .filter((tag) => parseStableTag(tag) && remoteTags.has(tag))
            .map((tag) => ({ tag, ...parseStableTag(tag) })).sort((a, b) => compareVersions(a.version, b.version));
        const latest = versions.at(-1);
        const stable = latest?.version;
        if (!stable) throw new Error('Для хотфикса необходим опубликованный stable-тег production.');
        const stableTag = latest.tag;
        const stableSha = git('rev-parse', `refs/tags/${stableTag}^{commit}`).trim();
        for (const tag of stableTagNames(stable).filter((name) => remoteTags.has(name))) {
            if (git('rev-parse', `refs/tags/${tag}^{commit}`).trim() !== stableSha) {
                throw new Error(`Конфликт stable-тегов версии ${stable}: разные commits.`);
            }
        }
        const productionText = readAt(mainSha);
        return { remoteTags, stable, stableTag, productionText, target: upVersion(stable, 'patch') };
    }, (value) => `последний опубликованный stable-тег ${value.stableTag} достижим из production`,
    productionRef ? null : 'не удалось определить production commit');
    return { repositoryRootOk: root.ok, ...productionRef, ...history.value, ...stable.value };
}

function assertTagAvailable(ctx, allowMatchingLocal = false) {
    for (const tag of stableTagNames(ctx.target)) {
        if (ctx.remoteTags.has(tag)) throw new Error(`Тег ${tag} уже опубликован; эту версию нельзя выпустить повторно.`);
        if (exists(`refs/tags/${tag}`) &&
            (!allowMatchingLocal || tag !== `hotfix/${ctx.target}` || git('rev-parse', `refs/tags/${tag}^{commit}`).trim() !== ctx.head)) {
            throw new Error(`Локальный тег ${tag} уже существует. Проверьте его перед продолжением.`);
        }
    }
}

function assertOriginUnchanged(ctx) {
    const line = git('ls-remote', '--heads', 'origin', `refs/heads/${ctx.mainBranch}`).trim();
    if (line.split(/\s+/)[0] !== ctx.mainSha) {
        throw new Error('Production изменилась во время проверки. Обновите ветку и повторите команду.');
    }
}

function currentFragments() {
    if (!preflight.findChangelogFragmentFiles().length) return [];
    const result = preflight.requireChangelogFragments();
    if (!result.ok) throw new Error(result.reason);
    return result.data.changelogFragments.map((fragment) => {
        if (fragment.bump !== 'patch') throw new Error(`Хотфикс не допускает minor/major: ${fragment.filePath}.`);
        return { ...fragment, content: fs.readFileSync(fragment.filePath, 'utf8') };
    });
}

function run(action) {
    try {
        return action() !== false;
    } catch (error) {
        logError('❌', error.message);
        return false;
    }
}

module.exports = { preflightReport, context, assertTagAvailable, assertOriginUnchanged, currentFragments, run };
