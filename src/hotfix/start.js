const fs = require('fs');
const preflight = require('../preflight');
const { execCommand, logSuccess } = require('../common/utils');
const { isDryRun, reportDryRun } = require('../cli/command-executor');
const { CHANGELOG_FILE } = require('../changelog/config');
const { prepareChangelog } = require('../changelog/hotfix');
const { preflightReport, context, assertTagAvailable, assertOriginUnchanged, currentFragments, run } = require('./checks');
function formatChangelog() {
    const runner = preflight.getPrettierRunner();
    if (!runner || !execCommand(`${runner} --write CHANGELOG.md`) || !execCommand(`${runner} --check CHANGELOG.md`)) {
        throw new Error('Не удалось отформатировать CHANGELOG.md; hotfix fragments сохранены.');
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

module.exports = { hotfixStart };
