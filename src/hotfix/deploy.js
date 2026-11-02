const { logSuccess } = require('../common/utils');
const { isDryRun, reportDryRun } = require('../cli/command-executor');
const { pendingDocument } = require('../changelog/hotfix');
const { git, exists } = require('./git');
const { preflightReport, context, assertTagAvailable, assertOriginUnchanged, currentFragments, run } = require('./checks');
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

module.exports = { hotfixDeploy };
