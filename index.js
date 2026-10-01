#!/usr/bin/env node
const { Command } = require("commander");
const program = new Command();

const git = require("./src/git");
const release = require("./src/release");
const hotfix = require("./src/hotfix");
const changelog = require("./src/changelog");
const chart = require("./src/chart");
const token = require("./src/token");
const { checkForUpdates, upgrade } = require("./src/update-check");
const { withCommandOptions } = require("./src/command-executor");
const { version: pkgVersion } = require("./package.json");

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

program
  .name("spectrum")
  .description("🚀 Spectrum CLI для процесса разработки")
  .version(pkgVersion, "-v, --version");

program
  .command("upgrade")
  .description("Обновить Spectrum CLI через npm install -g spectrum-cli")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(upgrade, command));

// Команды релиза
const releaseCmd = program
  .command("release")
  .description("Команды управления релизом");

releaseCmd
  .command("start")
  .description("Схлопнуть fragments и атомарно отправить release commit в dev и main/master")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(release.releaseStart, command));

releaseCmd
  .command("close")
  .description("Свести стабильный релиз из main/master в dev")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(release.releaseClose, command));

releaseCmd
  .command("deploy")
  .description("Создать и отправить только стабильный тег release/X.Y.Z")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(git.gitCreateTagAndPush, command));

const hotfixCmd = program.command("hotfix").description("Изолированный цикл срочного patch-релиза");

hotfixCmd.command("start")
  .description("Подготовить 🩹 CHANGELOG на hotfix/* или main/master, без commit, push и merge")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(hotfix.hotfixStart, command));
hotfixCmd.command("deploy")
  .description("После merge хотфикса отправить stable-тег с main/master")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(hotfix.hotfixDeploy, command));
hotfixCmd.command("close")
  .description("После stable pipeline свести production в dev")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(hotfix.hotfixClose, command));

// Команды changelog
const changelogCmd = program
  .command("changelog")
  .description("Команды управления changelog fragments");

changelogCmd
  .command("append <message>")
  .description("Создать changelog fragment с номером задачи из ветки")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((message, command) => runAction(() => changelog.changelogAppend(message), command));

changelogCmd
  .command("check")
  .description("Проверить CHANGELOG.md и changelog fragments")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(changelog.changelogCheck, command));

changelogCmd
  .command("write")
  .description("Привести заголовки CHANGELOG.md к формату релиза и запустить Prettier")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(changelog.changelogWrite, command));

// Команды chart
const chartCmd = program
  .command("chart")
  .description("Команды управления тегами chart");

chartCmd
  .command("start")
  .description("Создать и отправить chart-тег по верхней версии CHANGELOG.md чарта")
  .allowExcessArguments(false)
  .option("-f, --force", "Разрешить версию не больше последней версии тега на origin")
  .option("-n, --no-wait", "Не ждать публикации версии чарта в Helm-registry")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(chart.chartStart, command));

chartCmd
  .command("verify <source_path>")
  .description("Проверить пути ingress chart относительно исходников Next.js")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((sourcePath, command) => runAction(() => chart.chartVerify(sourcePath), command));

chartCmd
  .command("deploy")
  .description("Задеплоить последнюю версию chart в файлы helmrelease")
  .option("-i, --instances <names>", "Список инстансов через запятую (по умолчанию все)")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(chart.chartDeploy, command));

const tokenCmd = program
  .command("token")
  .description("Команды управления GitLab токенами");

tokenCmd
  .command("rotate")
  .description("Пролить GITLAB_PRIVATE_TOKEN в CI variables через owner PAT")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(token.tokenRotate, command));

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

program.parse();
