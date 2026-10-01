const { checkForUpdates } = require('./update-check');
const { withCommandOptions } = require('./command-executor');

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

module.exports = { runAction };
