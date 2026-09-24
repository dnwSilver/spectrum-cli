const fs = require('fs');
const { execFileSync } = require('child_process');
const preflight = require('./preflight');
const { execCommand, logSuccess, logError } = require('./utils');
const { upVersion, compareVersions } = require('./version');
const { STABLE_TAG_PATTERNS, parseStableTag, stableTagNames } = require('./stable-tags');
const { CHANGELOG_FILE, CHANGELOG_DIR, FRAGMENT_TYPES, getFragmentType } = require('./changelog-config');
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
    if (fs.realpathSync(root) !== fs.realpathSync(process.cwd())) {
        throw new Error('Запустите hotfix из корня репозитория.');
    }
    const branch = git('branch', '--show-current').trim();
    if (!['main', 'master'].includes(branch) && !/^hotfix\/.+/.test(branch)) {
        throw new Error('Hotfix-команды разрешены только на hotfix/*, main или master (не detached HEAD).');
    }
    if (mode !== 'start' && !['main', 'master'].includes(branch)) {
        throw new Error('hotfix deploy/close выполняются на main/master после merge хотфикса.');
    }
    if (mode === 'start' && !/^hotfix\/[A-Z]+-[0-9]+(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(branch)) {
        throw new Error('hotfix start выполняется только на hotfix/<TASK>[-slug].');
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
    const stableText = readAt(`refs/tags/${stableTag}`);
    const productionText = readAt(mainSha);
    const target = upVersion(stable, 'patch');
    return { mainBranch, mainSha, head, remoteTags, stable, stableTag, stableText, productionText, target };
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

function newFragments(baseRef) {
    const inherited = git('ls-tree', '-r', '-z', '--name-only', baseRef, '--', `${CHANGELOG_DIR}/`)
        .split('\0').filter(Boolean);
    for (const file of inherited) {
        if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== readAt(baseRef, file)) {
            throw new Error(`Нельзя изменять унаследованный fragment ${file} в хотфиксе.`);
        }
    }
    if (!fs.existsSync(CHANGELOG_DIR)) return [];
    return fs.readdirSync(CHANGELOG_DIR).sort().filter((name) => !name.startsWith('.'))
        .map((name) => `${CHANGELOG_DIR}/${name}`).filter((file) => !inherited.includes(file))
        .map((filePath) => {
            const type = getFragmentType(filePath);
            if (!type || !fs.lstatSync(filePath).isFile()) throw new Error(`Некорректный fragment ${filePath}.`);
            const content = fs.readFileSync(filePath, 'utf8');
            const entries = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            if (!entries.length || entries.some((line) => !line.startsWith('- ') || line.length > 120)) {
                throw new Error(`Пустой или неверно оформленный fragment ${filePath}: записи «- …», до 120 символов.`);
            }
            if (FRAGMENT_TYPES[type].bump !== 'patch') throw new Error(`Хотфикс не допускает minor/major: ${filePath}.`);
            return { filePath, content, type, ...FRAGMENT_TYPES[type], entries };
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
        const fragments = newFragments(ctx.mainSha);
        const original = fs.readFileSync(CHANGELOG_FILE, 'utf8');
        const updated = prepareChangelog({ text: original, ...ctx, fragments });
        assertOriginUnchanged(ctx);
        if (updated !== original || fragments.length) {
            try {
                fs.writeFileSync(CHANGELOG_FILE, updated);
                formatChangelog();
                // Formatting must not rewrite published history or lose merged notes.
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
        const prepared = pendingDocument(ctx.productionText, ctx.stableText, ctx.target);
        if (!prepared.pending) throw new Error(`В CHANGELOG.md нужен верхний подготовленный раздел ${ctx.target}.`);
        if (newFragments(`refs/tags/${ctx.stableTag}`).length) throw new Error('В production остались несобранные hotfix fragments.');
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
