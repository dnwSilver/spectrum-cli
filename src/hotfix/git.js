const { execFileSync } = require('child_process');
const { CHANGELOG_FILE } = require('../changelog/config');
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

module.exports = { git, exists, ancestor, readAt };
