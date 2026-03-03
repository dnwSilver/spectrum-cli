#!/usr/bin/env node
const { Command } = require("commander");
const program = new Command();

const git = require("./src/git");
const version = require("./src/version");
const release = require("./src/release");
const changelog = require("./src/changelog");
const chart = require("./src/chart");
const { version: pkgVersion } = require("./package.json");

async function runAction(action, ...args) {
  try {
    const result = await action(...args);
    if (!result) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Ошибка: ${error.message}`);
    process.exit(1);
  }
}

program
  .name("spectrum")
  .description("🚀 Spectrum CLI для процесса разработки")
  .version(pkgVersion, "-v, --version");

// Команды релиза
const releaseCmd = program
  .command("release")
  .description("Команды управления релизом");

releaseCmd
  .command("start")
  .description("Запустить полный процесс релиза")
  .action(() => runAction(release.releaseStart));

releaseCmd
  .command("close")
  .description("Закрыть релиз и влить в dev")
  .action(() => runAction(release.releaseClose));

releaseCmd
  .command("deploy")
  .description("Деплой релиза (создать и отправить тег)")
  .action(() => runAction(git.gitCreateTagAndPush));

// Команды обновления версии
const versionCmd = program
  .command("version")
  .description("Обновить версию по semantic versioning");

const upCmd = versionCmd
  .command("up")
  .description("Обновить версию по semantic versioning");

upCmd
  .command("major")
  .description("Повысить major версию (x.0.0)")
  .action(() => runAction(() => version.setVersion("major")));

upCmd
  .command("minor")
  .description("Повысить minor версию (x.y.0)")
  .action(() => runAction(() => version.setVersion("minor")));

upCmd
  .command("patch")
  .description("Повысить patch версию (x.y.z)")
  .action(() => runAction(() => version.setVersion("patch")));

// Команды changelog
const changelogCmd = program
  .command("changelog")
  .description("Команды управления changelog");

changelogCmd
  .command("append <message>")
  .description("Добавить запись в changelog с номером задачи из ветки")
  .action((message) => runAction(() => changelog.changelogAppend(message)));

// Команды chart
const chartCmd = program
  .command("chart")
  .description("Команды управления тегами chart");

chartCmd
  .command("create <version>")
  .description("Создать и отправить chart-тег (chart-<name>-<version>)")
  .action((version) => runAction(() => chart.chartCreateTag(version)));

chartCmd
  .command("verify <source_path>")
  .description("Проверить пути ingress chart относительно исходников Next.js")
  .action((sourcePath) => runAction(() => chart.chartVerify(sourcePath)));

chartCmd
  .command("deploy")
  .description("Задеплоить последнюю версию chart в файлы helmrelease")
  .action(() => runAction(chart.chartDeploy));

// Переопределяем help, чтобы показать кастомный формат с алиасами
program.configureHelp({
  formatHelp: (cmd, helper) => {
    const termWidth = helper.padWidth(cmd, helper);
    const helpWidth = helper.helpWidth || 80;
    const itemIndentWidth = 2;
    const itemSeparatorWidth = 2;
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

program.parse();
