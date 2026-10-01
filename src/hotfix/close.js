const { logSuccess } = require('../common/utils');
const { isDryRun, reportDryRun } = require('../cli/command-executor');
const { parseChangelog } = require('../changelog/hotfix');
const { git, exists, ancestor } = require('./git');
const { preflightReport, context, assertOriginUnchanged, run } = require('./checks');
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

module.exports = { hotfixClose };
