const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const preflight = require('./preflight');
const { execCommand, logSuccess, logError } = require('./utils');
const { isDryRun, reportDryRun, reportPreflight } = require('./command-executor');
const { upVersion, compareVersions } = require('./version');
const { STABLE_TAG_PATTERNS, parseStableTag, stableTagNames } = require('./stable-tags');
const { CHANGELOG_FILE } = require('./changelog-config');
const { parseChangelog, pendingDocument, prepareChangelog } = require('./hotfix-changelog');

function git(...args) {
    try {
        return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
        throw new Error(`Git не выполнил «${args[0]}». Проверьте доступ к origin, состояние веток и конфликты.`);
    }
}

function exists(ref) {
    try {
        execFileSync('git', ['show-ref', '--verify', '--quiet', ref], { stdio: 'ignore' });
        return true;
    } catch (error) {
        if (error.status === 1) return false;
        throw new Error(`Не удалось проверить ref ${ref}.`);
    }
}

function ancestor(base, head) {
    try {
        execFileSync('git', ['merge-base', '--is-ancestor', base, head], { stdio: 'ignore' });
        return true;
    } catch (error) {
        if (error.status === 1) return false;
        throw new Error('Не удалось проверить историю Git.');
    }
}

function readAt(ref, file = CHANGELOG_FILE) {
    return git('show', `${ref}:${file}`);
}

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

function formatChangelog() {
    const runner = preflight.getPrettierRunner();
    if (!runner || !execCommand(`${runner} --write CHANGELOG.md`) || !execCommand(`${runner} --check CHANGELOG.md`)) {
        throw new Error('Не удалось отформатировать CHANGELOG.md; hotfix fragments сохранены.');
    }
}

function run(action) {
    try {
        return action() !== false;
    } catch (error) {
        logError('❌', error.message);
        return false;
    }
}

function hotfixStart() {
    return run(() => {
        const checks = preflightReport('hotfix start');
        const ctx = context('start', checks);
        checks.check('tag-missing', () => assertTagAvailable(ctx),
            `теги версии ${ctx.target} отсутствуют локально и на origin`,
            ctx.target ? null : 'не определена целевая версия хотфикса');
        const fragmentsResult = checks.check('changelog-fragments', currentFragments,
            (value) => `проверены ${value.length} patch fragments`,
            ctx.repositoryRootOk ? null : 'не пройдена проверка корня репозитория');
        let original;
        const changelog = checks.check('changelog-state', () => {
            original = fs.readFileSync(CHANGELOG_FILE, 'utf8');
            return prepareChangelog({ text: original, ...ctx, fragments: fragmentsResult.value });
        }, `CHANGELOG.md допускает подготовку хотфикса ${ctx.target}`,
        ctx.target && fragmentsResult.ok ? null : 'не определена версия хотфикса или не проверены fragments');
        checks.check('origin-unchanged', () => assertOriginUnchanged(ctx),
            'production-ветка на origin не изменилась во время проверки',
            ctx.mainBranch && ctx.mainSha ? null : 'не проверена история production');
        if (!checks.ok) return false;
        const updated = changelog.value;
        if (isDryRun()) {
            reportDryRun('hotfix start');
            return;
        }
        if (updated !== original || fragmentsResult.value.length) {
            try {
                fs.writeFileSync(CHANGELOG_FILE, updated);
                formatChangelog();
                // Validate the formatted current file and keep all merged hotfix notes.
                prepareChangelog({ text: fs.readFileSync(CHANGELOG_FILE, 'utf8'), ...ctx, fragments: [] });
                for (const fragment of fragmentsResult.value) fs.unlinkSync(fragment.filePath);
            } catch (error) {
                fs.writeFileSync(CHANGELOG_FILE, original);
                for (const fragment of fragmentsResult.value) fs.writeFileSync(fragment.filePath, fragment.content);
                throw error;
            }
        }
        logSuccess('✅', `Хотфикс ${ctx.target} подготовлен локально. Проверьте diff и включите CHANGELOG.md и удаления fragments в MR в ${ctx.mainBranch}.`);
    });
}

function hotfixDeploy() {
    return run(() => {
        const checks = preflightReport('hotfix deploy');
        const ctx = context('deploy', checks);
        checks.check('prepared-changelog', () => {
            const prepared = pendingDocument(ctx.productionText, ctx.target);
            if (!prepared.pending) throw new Error(`В CHANGELOG.md нужен верхний подготовленный раздел ${ctx.target}.`);
        }, `верхний раздел CHANGELOG.md содержит хотфикс ${ctx.target}`,
        ctx.productionText && ctx.target ? null : 'не определены production changelog или версия хотфикса');
        checks.check('changelog-fragments', () => {
            if (currentFragments().length) throw new Error('В production остались несобранные hotfix fragments.');
        }, 'несобранных hotfix fragments нет',
        ctx.repositoryRootOk ? null : 'не пройдена проверка корня репозитория');
        checks.check('tag-missing', () => assertTagAvailable(ctx, true),
            `тег hotfix/${ctx.target} доступен для публикации`,
            ctx.target ? null : 'не определена целевая версия хотфикса');
        checks.check('origin-unchanged', () => assertOriginUnchanged(ctx),
            'production-ветка на origin не изменилась во время проверки',
            ctx.mainBranch && ctx.mainSha ? null : 'не проверена история production');
        if (!checks.ok) return false;
        if (isDryRun()) {
            reportDryRun('hotfix deploy');
            return;
        }
        const tag = `hotfix/${ctx.target}`;
        if (!exists(`refs/tags/${tag}`)) git('tag', tag, ctx.head);
        git('push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`);
        logSuccess('✅', `Опубликован ${tag} на ${ctx.head}. Дождитесь успешного stable pipeline перед hotfix close.`);
    });
}

function hotfixClose() {
    return run(() => {
        const checks = preflightReport('hotfix close');
        const ctx = context('close', checks);
        const tag = `hotfix/${ctx.stable}`;
        checks.check('stable-tag-at-head', () => {
            const top = parseChangelog(ctx.productionText).releases[0]?.version;
            if (top !== ctx.stable || !ctx.remoteTags.has(tag) || git('rev-parse', `refs/tags/${tag}^{commit}`).trim() !== ctx.head) {
                throw new Error('Сначала опубликуйте hotfix/X.Y.Z на текущем production commit.');
            }
        }, `опубликованный тег ${tag} указывает на текущий commit`,
        ctx.stable && ctx.productionText && ctx.remoteTags && ctx.head ? null : 'не определены stable-тег или production commit');
        const integration = checks.check('integration-history', () => {
            const dev = ['develop', 'dev'].find((name) => exists(`refs/remotes/origin/${name}`));
            if (!dev) throw new Error('Не найдена integration-ветка origin/dev или origin/develop.');
            const devRef = `refs/remotes/origin/${dev}`;
            if (exists(`refs/heads/${dev}`) && !ancestor(`refs/heads/${dev}`, devRef)) {
                throw new Error(`В ${dev} есть локальные непубликуемые commits. Сначала согласуйте их с origin/${dev}.`);
            }
            return { dev, devRef };
        }, (value) => `в локальной ветке ${value.dev} нет неопубликованных коммитов`,
        ctx.mainBranch ? null : 'не проверена история production');
        checks.check('origin-unchanged', () => assertOriginUnchanged(ctx),
            'production-ветка на origin не изменилась во время проверки',
            ctx.mainBranch && ctx.mainSha ? null : 'не проверена история production');
        if (!checks.ok) return false;
        if (isDryRun()) {
            reportDryRun('hotfix close');
            return;
        }
        const { dev, devRef } = integration.value;
        if (exists(`refs/heads/${dev}`)) git('switch', dev);
        else git('switch', '--track', '-c', dev, devRef);
        git('merge', '--ff-only', devRef);
        git('merge', '--no-edit', ctx.head);
        git('push', 'origin', `refs/heads/${dev}:refs/heads/${dev}`);
        logSuccess('✅', `Хотфикс ${ctx.stable} сведён в ${dev}; production и файлы версий не изменены.`);
    });
}

module.exports = { hotfixStart, hotfixDeploy, hotfixClose };
