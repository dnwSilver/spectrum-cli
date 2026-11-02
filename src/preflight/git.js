const { execSilent, execCommand, getCurrentBranch, getMainBranch, getDevelopBranch } = require('../common/utils');
const { ok, fail } = require('./result');
function requireGitRepo() {
    if (!execCommand('git rev-parse --is-inside-work-tree')) {
        return fail('Текущая директория не является git-репозиторием.');
    }
    return ok();
}

function requireCleanWorkingTree() {
    const status = execSilent('git status --porcelain');
    if (status === null) {
        return fail('Не удалось получить состояние рабочего дерева git.');
    }
    if (status.trim() !== '') {
        return fail('Рабочее дерево не чистое.');
    }
    return ok();
}

function requireMainAndDevBranches() {
    const branches = execSilent('git branch -r');
    if (!branches) {
        return fail('Не удалось получить список удаленных веток.');
    }

    const mainBranch = getMainBranch();
    const devBranch = getDevelopBranch();
    const hasMain = branches.includes(`origin/${mainBranch}`);
    const hasDev = branches.includes(`origin/${devBranch}`);

    if (!hasMain || !hasDev) {
        return fail(`Отсутствуют обязательные удаленные ветки (origin/${mainBranch}, origin/${devBranch}).`);
    }

    return ok({ mainBranch, devBranch });
}

function requireCurrentBranch(expectedBranch) {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Не удалось определить текущую ветку.');
    }
    if (currentBranch !== expectedBranch) {
        return fail(`Текущая ветка "${currentBranch}", ожидалась "${expectedBranch}".`);
    }
    return ok({ currentBranch });
}

function requireOnDevBranch() {
    const devBranch = getDevelopBranch();
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Не удалось определить текущую ветку.');
    }
    if (currentBranch !== devBranch) {
        return fail(`Текущая ветка "${currentBranch}", ожидалась "${devBranch}".`);
    }
    return ok({ devBranch, currentBranch });
}


function requireOnMainBranch() {
    const mainBranch = getMainBranch();
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Не удалось определить текущую ветку.');
    }
    if (currentBranch !== mainBranch) {
        return fail(`Текущая ветка "${currentBranch}", ожидалась "${mainBranch}".`);
    }
    return ok({ mainBranch, currentBranch });
}

function requireRemoteOrigin() {
    const remoteUrl = execSilent('git remote get-url origin');
    if (!remoteUrl) {
        return fail('Удаленный репозиторий "origin" не настроен.');
    }
    return ok({ remoteOrigin: remoteUrl });
}

function requireRemoteReachable() {
    const remoteHeads = execSilent('git ls-remote --heads origin');
    if (remoteHeads === null) {
        return fail('Не удалось получить доступ к удаленному репозиторию "origin".');
    }
    return ok();
}

function requireCurrentBranchUpToDateWithRemote() {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
        return fail('Не удалось определить текущую ветку.');
    }

    if (!execCommand('git fetch origin --prune --tags')) {
        return fail('Не удалось получить изменения с удаленного репозитория.');
    }

    const upstreamBranch = execSilent('git rev-parse --abbrev-ref --symbolic-full-name "@{u}"');
    if (!upstreamBranch || !upstreamBranch.trim()) {
        return fail(`Для текущей ветки "${currentBranch}" не настроена upstream-ветка.`);
    }

    const aheadBehind = execSilent(`git rev-list --left-right --count HEAD...${upstreamBranch.trim()}`);
    if (!aheadBehind) {
        return fail(`Не удалось сравнить текущую ветку "${currentBranch}" с "${upstreamBranch.trim()}".`);
    }

    const parts = aheadBehind.trim().split(/\s+/);
    const behindBy = Number(parts[1] || 0);
    if (!Number.isFinite(behindBy)) {
        return fail(`Не удалось разобрать информацию ahead/behind для "${upstreamBranch.trim()}".`);
    }

    if (behindBy > 0) {
        return fail(`В удаленной ветке есть новые коммиты (${behindBy}). Выполните "git pull" и повторите попытку.`);
    }

    return ok({ currentBranch, upstreamBranch: upstreamBranch.trim() });
}

function requireDevContainsRemoteMain() {
    const mainBranch = getMainBranch();
    const remoteMain = `origin/${mainBranch}`;
    if (!execCommand(`git merge-base --is-ancestor ${remoteMain} HEAD`)) {
        return fail(`Текущая ветка не содержит ${remoteMain}. Смержите ${remoteMain} в dev и повторите попытку.`);
    }
    return ok({ remoteMain });
}

module.exports = { requireGitRepo, requireCleanWorkingTree, requireMainAndDevBranches, requireCurrentBranch, requireOnDevBranch, requireOnMainBranch, requireRemoteOrigin, requireRemoteReachable, requireCurrentBranchUpToDateWithRemote, requireDevContainsRemoteMain };
