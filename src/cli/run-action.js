const { checkForUpdates } = require('./update-check');
const { withCommandOptions, reportDryRun } = require('./command-executor');

function commandOptions(command) {
  return command && typeof command.opts === "function" ? command.opts() : command || {};
}

async function runAction(action, command) {
  const options = commandOptions(command);
  if (!options.dry) {
    try {
      await checkForUpdates();
    } catch {
      // A failed update check must not affect the command.
    }
  }
  try {
    const result = await withCommandOptions(options, () => action(options));
    if (!result) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Ошибка: ${error.message}`);
    process.exit(1);
  }
}

// Automation handlers return numeric exit codes, including 0 (success)
// and 2 (partial result). They run without the interactive update check.
async function runAutomationAction(action, command) {
  const options = commandOptions(command);
  try {
    process.exitCode = await withCommandOptions(options, async () => {
      const code = await action(options);
      if (options.dry && code === 0) reportDryRun();
      return code;
    });
  } catch (error) {
    console.error('ERROR: ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { runAction, runAutomationAction };
