const git = require('../git');
const release = require('../release');
const hotfix = require('../hotfix');
const changelog = require('../changelog');
const chart = require('../chart');
const token = require('../token');
const nextjs = require('../nextjs');
const sbom = require('../sbom');
const security = require('../security');
const { upgrade } = require('./update-check');
const { version: pkgVersion } = require('../../package.json');
const { runAction, runAutomationAction } = require('./run-action');

function registerCommands(program) {
program
  .name("spectrum")
  .description("🚀 Spectrum CLI для процесса разработки")
  .version(pkgVersion, "-v, --version");

program
  .command("upgrade")
  .description("Обновить Spectrum CLI через npm install -g spectrum-cli")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(upgrade, command));

// Команды Next.js
const nextjsCmd = program
  .command("nextjs")
  .description("Обработка Next.js build artifacts");

nextjsCmd
  .command("licenses")
  .description("Сохранить LICENSE встроенных пакетов в standalone")
  .allowExcessArguments(false)
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAutomationAction(nextjs.licenses, command));

// Команды SBOM
const sbomCmd = program
  .command("sbom")
  .description("Работа с SBOM");

const catalogCmd = sbomCmd
  .command("catalog")
  .description("Каталоги встроенных зависимостей Next.js");

catalogCmd
  .command("resolve")
  .description("Найти проверенные OCI-каталоги для образа приложения")
  .allowExcessArguments(false)
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAutomationAction(sbom.resolve, command));

catalogCmd
  .command("populate")
  .description("Построить и опубликовать каталог из официальных исходников")
  .allowExcessArguments(false)
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAutomationAction(sbom.populate, command));

// Команды security
const securityCmd = program
  .command("security")
  .description("Ночная проверка и исправление HIGH/CRITICAL");

securityCmd
  .command("scan")
  .description("Проверить production npm-зависимости и runtime-образ")
  .allowExcessArguments(false)
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAutomationAction(security.scan, command));

securityCmd
  .command("track")
  .description("Создать или найти YouTrack-задачи в центральном pipeline")
  .allowExcessArguments(false)
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAutomationAction(security.track, command));

securityCmd
  .command("reconcile")
  .description("Дождаться центрального tracker и получить номера задач")
  .allowExcessArguments(false)
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAutomationAction(security.reconcile, command));

securityCmd
  .command("repair")
  .description("Исправить, проверить и создать отдельный MR на проектную задачу")
  .allowExcessArguments(false)
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAutomationAction(security.repair, command));

// Команды релиза
const releaseCmd = program
  .command("release")
  .description("Команды управления релизом");

releaseCmd
  .command("start")
  .description("Схлопнуть fragments и атомарно отправить release commit в dev и main/master")
  .option("--stable", "Явно перейти с 0.x на первый стабильный релиз 1.0.0")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(release.releaseStart, command));

releaseCmd
  .command("close")
  .description("Свести стабильный релиз из main/master в dev")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(release.releaseClose, command));

releaseCmd
  .command("deploy")
  .description("Создать и отправить только стабильный тег release/X.Y.Z")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(git.gitCreateTagAndPush, command));

const hotfixCmd = program.command("hotfix").description("Изолированный цикл срочного patch-релиза");

hotfixCmd.command("start")
  .description("Подготовить 🩹 CHANGELOG на hotfix/* или main/master, без commit, push и merge")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(hotfix.hotfixStart, command));
hotfixCmd.command("deploy")
  .description("После merge хотфикса отправить stable-тег с main/master")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(hotfix.hotfixDeploy, command));
hotfixCmd.command("close")
  .description("После stable pipeline свести production в dev")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
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
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((message, command) => runAction(() => changelog.changelogAppend(message), command));

changelogCmd
  .command("check")
  .description("Проверить CHANGELOG.md и changelog fragments")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(changelog.changelogCheck, command));

changelogCmd
  .command("write")
  .description("Привести заголовки CHANGELOG.md к формату релиза и запустить Prettier")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
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
  .option("--no-wait", "Не ждать публикации версии чарта в Helm-registry")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(chart.chartStart, command));

chartCmd
  .command("verify <source_path>")
  .description("Проверить пути ingress chart относительно исходников Next.js")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((sourcePath, command) => runAction(() => chart.chartVerify(sourcePath), command));

chartCmd
  .command("deploy")
  .description("Задеплоить последнюю версию chart в файлы helmrelease")
  .option("-i, --instances <names>", "Список инстансов через запятую (по умолчанию все)")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(chart.chartDeploy, command));

const tokenCmd = program
  .command("token")
  .description("Команды управления GitLab токенами");

tokenCmd
  .command("rotate")
  .description("Пролить SC_BOT_PAT в CI variables через owner PAT")
  .option("-n, --no-verify", "Выполнить команду без предпроверок")
  .option("-d, --dry", "Запустить только предпроверки")
  .option("-s, --silence", "Скрыть сообщения об успешно пройденных предпроверках")
  .action((command) => runAction(token.tokenRotate, command));
}

module.exports = { registerCommands };
