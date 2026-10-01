const { parseStableTag, stableTagNames } = require('../release/stable-tags');
const { execSilent, getMainBranch } = require('../common/utils');
const { ok, fail, STABLE_SEMVER_PATTERN, YOUTRACK_TASK_PATTERN } = require('./result');
const { getChangelogReleaseVersions } = require('./changelog');
const { CHANGELOG_FILE } = require('../changelog/config');
function compareStableVersions(left, right) {
    const leftParts = String(left).split('.').map(Number);
    const rightParts = String(right).split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
        if (leftParts[index] !== rightParts[index]) {
            return leftParts[index] - rightParts[index];
        }
    }
    return 0;
}

function requireNoPendingRelease(stableVersion) {
    if (!STABLE_SEMVER_PATTERN.test(String(stableVersion || ''))) {
        return fail('Для проверки незакрытых релизов требуется последний стабильный SemVer X.Y.Z.');
    }

    const changelogReleaseVersions = getChangelogReleaseVersions();
    const pendingVersions = [...new Set(changelogReleaseVersions)]
        .filter((version) => compareStableVersions(version, stableVersion) > 0)
        .sort((left, right) => compareStableVersions(right, left));

    if (pendingVersions.length > 0) {
        return fail(
            `В ${CHANGELOG_FILE} найдены незакрытые релизы новее stable-версии ${stableVersion}: ${pendingVersions.join(', ')}. ` +
            'Сначала выполните "spectrum release deploy", дождитесь успешного stable pipeline и выполните "spectrum release close".'
        );
    }

    return ok({ changelogReleaseVersions });
}

function requireLatestStableVersion() {
    const mainBranch = getMainBranch();
    const tagNames = execSilent(`git tag --merged origin/${mainBranch} --list "release/*" "hotfix/*" "v*"`);
    const remoteTagRefs = execSilent('git ls-remote --refs --tags origin "refs/tags/release/*" "refs/tags/hotfix/*" "refs/tags/v*"');
    if (tagNames === null || remoteTagRefs === null) {
        return fail(`Не удалось проверить стабильные теги, достижимые из origin/${mainBranch}.`);
    }

    const remoteTagNames = new Set();
    for (const line of remoteTagRefs.split('\n')) {
        const match = line.trim().match(/^[0-9a-f]+\s+refs\/tags\/(.+)$/i);
        if (match && parseStableTag(match[1])) remoteTagNames.add(match[1]);
    }

    const versions = new Set();
    for (const line of tagNames.split('\n')) {
        const tagName = line.trim();
        const parsed = parseStableTag(tagName);
        if (parsed && remoteTagNames.has(tagName)) {
            versions.add(parsed.version);
        }
    }

    if (versions.size === 0) {
        return fail(`В origin/${mainBranch} не найден достижимый stable-тег release/X.Y.Z, hotfix/X.Y.Z или vX.Y.Z.`);
    }

    const stableVersion = [...versions].sort(compareStableVersions).at(-1);
    return ok({ stableVersion });
}

function requireStableTagAtHead(version) {
    if (!STABLE_SEMVER_PATTERN.test(String(version || ''))) return fail('Требуется stable-версия X.Y.Z.');
    const head = execSilent('git rev-parse HEAD');
    const names = stableTagNames(version);
    const patterns = names.flatMap((tag) => [`"refs/tags/${tag}"`, `"refs/tags/${tag}^{}"`]).join(' ');
    const tagRefs = execSilent(`git ls-remote --tags origin ${patterns}`);
    if (!head || tagRefs === null) return fail(`Не удалось проверить stable-теги версии ${version}.`);
    const refs = new Map(tagRefs.trim().split('\n').filter(Boolean).map((line) => {
        const [sha, ref] = line.trim().split(/\s+/);
        return [ref, sha];
    }));
    const commits = names.map((tag) => refs.get(`refs/tags/${tag}^{}`) || refs.get(`refs/tags/${tag}`)).filter(Boolean);
    if (!commits.length) return fail(`Stable-тег версии ${version} отсутствует в origin.`);
    if (commits.some((commit) => commit !== head)) return fail(`Stable-тег ${version} не совпадает с HEAD или конфликтует с alias.`);
    return ok({ stableVersion: version });
}

function requireYouTrackTask(task) {
    if (!YOUTRACK_TASK_PATTERN.test(String(task || ''))) {
        return fail('Номер задачи должен соответствовать формату YOUTRACK-ID, например AR-123.');
    }
    return ok({ task });
}

function requireTagMissing(tagName) {
    const parsed = parseStableTag(tagName);
    const names = parsed ? stableTagNames(parsed.version) : [tagName];
    const localTag = execSilent(`git tag -l ${names.map((tag) => `"${tag}"`).join(' ')}`);
    if (localTag === null) return fail('Не удалось проверить локальные теги.');
    if (localTag.trim()) return fail(`Версия тега ${tagName} уже существует локально: ${localTag}.`);
    const remoteTag = execSilent(`git ls-remote --tags origin ${names.map((tag) => `"refs/tags/${tag}"`).join(' ')}`);
    if (remoteTag === null) return fail('Не удалось проверить теги origin.');
    if (remoteTag.trim()) return fail(`Версия тега ${tagName} уже существует на origin.`);
    return ok();
}

function requireReleaseVersionAvailable(version) {
    if (!STABLE_SEMVER_PATTERN.test(String(version || ''))) {
        return fail('Целевая release-версия должна соответствовать X.Y.Z.');
    }

    const localBranches = execSilent(`git branch --list "hotfix/*-${version}"`);
    if (localBranches && localBranches.trim()) {
        return fail(`Версия "${version}" уже используется локальной hotfix-веткой.`);
    }

    const remoteBranches = execSilent(`git ls-remote --heads origin "refs/heads/hotfix/*-${version}"`);
    if (remoteBranches === null) {
        return fail('Не удалось проверить hotfix-ветки в origin.');
    }
    if (remoteBranches && remoteBranches.trim()) {
        return fail(`Версия "${version}" уже используется hotfix-веткой в origin.`);
    }

    const names = stableTagNames(version);
    const localTag = execSilent(`git tag --list ${names.map((tag) => `"${tag}"`).join(' ')}`);
    if (localTag === null) return fail('Не удалось проверить локальные stable-теги.');
    if (localTag && localTag.trim()) {
        return fail(`Релизный тег версии ${version} уже существует локально.`);
    }

    const remoteTag = execSilent(`git ls-remote --tags origin ${names.flatMap((tag) => [`"refs/tags/${tag}"`, `"refs/tags/${tag}^{}"`]).join(' ')}`);
    if (remoteTag === null) {
        return fail(`Не удалось проверить тег версии ${version} в origin.`);
    }
    if (remoteTag && remoteTag.trim()) {
        return fail(`Релизный тег версии ${version} уже существует в origin.`);
    }
    return ok();
}

module.exports = { requireNoPendingRelease, requireLatestStableVersion, requireStableTagAtHead, requireYouTrackTask, requireTagMissing, requireReleaseVersionAvailable };
