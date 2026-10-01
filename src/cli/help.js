function configureHelp(program) {
// Переопределяем help, чтобы показать кастомный формат с алиасами
program.configureHelp({
  formatHelp: (cmd, helper) => {
    const cmdUsage = helper.commandUsage(cmd);
    const cmdDescription = helper.commandDescription(cmd);
    const options = helper.visibleOptions(cmd);
    const commands = helper.visibleCommands(cmd);

    let output = "";

    // Использование
    if (cmdUsage) {
      output += `Использование: ${cmdUsage}\n\n`;
    }

    // Описание
    if (cmdDescription) {
      output += `${cmdDescription}\n\n`;
    }

    // Команды с алиасами
    if (commands.length > 0) {
      output += "Команды:\n";
      commands.forEach((cmd) => {
        const nameAndArgs = cmd.name() + cmd.usage().replace(/^[^\s]+\s*/, " ");
        const aliases = cmd.aliases();
        const description = cmd.description();

        let cmdLine = `  ${nameAndArgs}`;
        if (aliases.length > 0) {
          cmdLine = cmdLine.padEnd(25) + `[${aliases.join(", ")}]`;
        }
        cmdLine = cmdLine.padEnd(40) + description;
        output += cmdLine + "\n";
      });
      output += "\n";
    }

    // Опции
    if (options.length > 0) {
      output += "Опции:\n";
      options.forEach((option) => {
        const flags = helper.optionTerm(option);
        const description = helper.optionDescription(option);
        output += `  ${flags.padEnd(25)} ${description}\n`;
      });
    }

    return output;
  },
});
}

module.exports = { configureHelp };
