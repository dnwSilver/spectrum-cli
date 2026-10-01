const git = require('../git');
const release = require('../release');
const hotfix = require('../hotfix');
const changelog = require('../changelog');
const chart = require('../chart');
const token = require('../token');
const { upgrade } = require('./update-check');
const { version: pkgVersion } = require('../../package.json');
const { runAction } = require('./run-action');

function registerCommands(program) {
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
}

module.exports = { registerCommands };
