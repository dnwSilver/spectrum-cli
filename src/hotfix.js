const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const preflight = require('./preflight');
const { execCommand, logSuccess, logError } = require('./utils');
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

function context(mode) {
    const root = git('rev-parse', '--show-toplevel').trim();
    if (path.relative(fs.realpathSync(root), fs.realpathSync(process.cwd())) !== '') {
        throw new Error('Запустите hotfix из корня репозитория.');
    }
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
    if (mode !== 'start' && git('status', '--porcelain').trim()) {
        throw new Error('Для deploy/close требуется чистое рабочее дерево.');
    }
    if (git('ls-files', '--unmerged').trim()) throw new Error('Сначала разрешите конфликты Git.');
    git('fetch', 'origin', '--prune', '--tags');
    const mainBranch = ['master', 'main'].find((name) => exists(`refs/remotes/origin/${name}`));
    if (!mainBranch) throw new Error('Не найдена production-ветка origin/main или origin/master.');
    const mainRef = `refs/remotes/origin/${mainBranch}`;
    const mainSha = git('rev-parse', mainRef).trim();
    const head = git('rev-parse', 'HEAD').trim();
    if (['main', 'master'].includes(branch) && branch !== mainBranch) {
        throw new Error(`Production-ветка origin — ${mainBranch}. Переключитесь на неё или на hotfix/<TASK>[-slug].`);
    }
    if (mode === 'start') {
        if (!ancestor(mainSha, head)) throw new Error('Сначала обновите hotfix из актуальной production-ветки.');
    } else if (branch !== mainBranch || head !== mainSha) {
        throw new Error(`Нужна ветка ${mainBranch}, точно совпадающая с origin/${mainBranch}.`);
    }
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
    const target = upVersion(stable, 'patch');
    return { mainBranch, mainSha, head, remoteTags, stable, stableTag, productionText, target };
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
        action();
        return true;
    } catch (error) {
        logError('❌', error.message);
        return false;
    }
}

function hotfixStart() {
    return run(() => {
        const ctx = context('start');
        assertTagAvailable(ctx);
        const fragments = currentFragments();
        const original = fs.readFileSync(CHANGELOG_FILE, 'utf8');
        const updated = prepareChangelog({ text: original, ...ctx, fragments });
        assertOriginUnchanged(ctx);
        if (updated !== original || fragments.length) {
            try {
                fs.writeFileSync(CHANGELOG_FILE, updated);
                formatChangelog();
                // Validate the formatted current file and keep all merged hotfix notes.
                prepareChangelog({ text: fs.readFileSync(CHANGELOG_FILE, 'utf8'), ...ctx, fragments: [] });
                for (const fragment of fragments) fs.unlinkSync(fragment.filePath);
            } catch (error) {
                fs.writeFileSync(CHANGELOG_FILE, original);
                for (const fragment of fragments) fs.writeFileSync(fragment.filePath, fragment.content);
                throw error;
            }
        }
        logSuccess('✅', `Хотфикс ${ctx.target} подготовлен локально. Проверьте diff и включите CHANGELOG.md и удаления fragments в MR в ${ctx.mainBranch}.`);
    });
}

function hotfixDeploy() {
    return run(() => {
        const ctx = context('deploy');
        const prepared = pendingDocument(ctx.productionText, ctx.target);
        if (!prepared.pending) throw new Error(`В CHANGELOG.md нужен верхний подготовленный раздел ${ctx.target}.`);
        if (currentFragments().length) throw new Error('В production остались несобранные hotfix fragments.');
        assertTagAvailable(ctx, true);
        assertOriginUnchanged(ctx);
        const tag = `hotfix/${ctx.target}`;
        if (!exists(`refs/tags/${tag}`)) git('tag', tag, ctx.head);
        git('push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`);
        logSuccess('✅', `Опубликован ${tag} на ${ctx.head}. Дождитесь успешного stable pipeline перед hotfix close.`);
    });
}

function hotfixClose() {
    return run(() => {
        const ctx = context('close');
        const top = parseChangelog(ctx.productionText).releases[0]?.version;
        const tag = `hotfix/${ctx.stable}`;
        if (top !== ctx.stable || !ctx.remoteTags.has(tag) || git('rev-parse', `refs/tags/${tag}^{commit}`).trim() !== ctx.head) {
            throw new Error('Сначала опубликуйте hotfix/X.Y.Z на текущем production commit.');
        }
        const dev = ['develop', 'dev'].find((name) => exists(`refs/remotes/origin/${name}`));
        if (!dev) throw new Error('Не найдена integration-ветка origin/dev или origin/develop.');
        const devRef = `refs/remotes/origin/${dev}`;
        if (exists(`refs/heads/${dev}`) && !ancestor(`refs/heads/${dev}`, devRef)) {
            throw new Error(`В ${dev} есть локальные непубликуемые commits. Сначала согласуйте их с origin/${dev}.`);
        }
        assertOriginUnchanged(ctx);
        if (exists(`refs/heads/${dev}`)) git('switch', dev);
        else git('switch', '--track', '-c', dev, devRef);
        git('merge', '--ff-only', devRef);
        git('merge', '--no-edit', ctx.head);
        git('push', 'origin', `refs/heads/${dev}:refs/heads/${dev}`);
        logSuccess('✅', `Хотфикс ${ctx.stable} сведён в ${dev}; production и файлы версий не изменены.`);
    });
}

module.exports = { hotfixStart, hotfixDeploy, hotfixClose };
