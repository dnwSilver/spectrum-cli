#!/usr/bin/env node
const { logError, logSuccess } = require('./utils');

function normalizeCheckResult(result, fallbackReason) {
    if (typeof result === 'boolean') {
        return { ok: result, reason: result ? null : fallbackReason };
    }

    if (typeof result === 'string') {
        return { ok: false, reason: result };
    }

    if (result && typeof result === 'object') {
        return {
            ok: Boolean(result.ok),
            reason: result.reason || fallbackReason,
            data: result.data
        };
    }

    return { ok: false, reason: fallbackReason };
}

async function runCommand(spec) {
    const {
        name,
        checks = [],
        steps = [],
        context = {}
    } = spec || {};

    if (!name) {
        logError('❌', 'Command name is required.');
        return false;
    }

    for (const check of checks) {
        const checkName = check.name || 'unknown-check';
        const checkResult = normalizeCheckResult(
            await check.run(context),
            `Check failed: ${checkName}`
        );

        if (!checkResult.ok) {
            logError('❌', '[%s] Preflight failed (%s): %s', name, checkName, checkResult.reason || 'unknown reason');
            return false;
        }

        if (checkResult.data && typeof checkResult.data === 'object') {
            Object.assign(context, checkResult.data);
        }
    }

    for (const step of steps) {
        const stepName = step.name || 'unknown-step';
        const ok = await step.run(context);
        if (!ok) {
            logError('❌', '[%s] Step failed: %s', name, stepName);
            return false;
        }
    }

    logSuccess('✅', '[%s] Completed.', name);
    return true;
}

module.exports = {
    runCommand
};
