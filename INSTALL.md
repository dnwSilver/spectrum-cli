# Установка Spectrum CLI

## Требования

- Node.js 20 или новее и npm 6 или новее (`package.json#engines`).
- Git для команд, работающих с репозиторием. Доступ к `origin` нужен для релизов, хотфиксов и тегов.
- Для команд, проверяющих или собирающих changelog, нужен доступный Prettier: установленный в проекте или вызываемый через `npx` (см. [README.md](./README.md#работа-с-changelog)).

## Установка из npm

```bash
npm install -g spectrum-cli
spectrum --version
spectrum --help
```

Пакет регистрирует команду `spectrum` через поле `bin` в `package.json`. Для обновления глобальной установки запустите `spectrum upgrade` (внутри выполняется `npm install -g spectrum-cli`). Перед выполнением команд с действием CLI пытается проверить новую версию в npm Registry; ожидание ограничено 200 мс, ошибка сети не блокирует команду. `--help` и `--version` эту проверку не запускают.

## Запуск из исходников

```bash
git clone https://github.com/dnwSilver/spectrum-cli.git
cd spectrum-cli
npm ci
node index.js --version
node index.js --help
```

Здесь запускается `index.js` из текущего checkout. `spectrum upgrade` обновляет глобальный npm-пакет, а не этот checkout.

## Установщик для Unix

В репозитории есть `install.sh`. Он скачивает **текущий `main`**, устанавливает зависимости в `~/.spectrum-cli`, создает ссылку `~/.local/bin/spectrum` и добавляет этот каталог в существующие `~/.bashrc`, `~/.zshrc` и `~/.profile`. Это не установка конкретного релизного тега и не глобальная npm-установка. Скрипту нужны Bash, `curl` или `wget`, `tar`, Node.js, npm и Git.

```bash
bash install.sh
bash install.sh --uninstall
```

После установки откройте новый shell или добавьте `~/.local/bin` в `PATH`. Для установки фиксированной версии используйте npm с явным `@X.Y.Z`.

## Перед использованием в проекте

Запускайте команды из корня Git-репозитория проекта. Для `changelog append` нужен `CHANGELOG.md` и ветка вида `<type>/<YOUTRACK-ID>[-slug]`, например `feature/ABC-123-login`. Команда создает файл `.changelog/<name>.<type>.md`; `changelog check` проверяет его и формат `CHANGELOG.md`.

`release start` требует ветку `dev`/`develop`, настроенный `origin`, production-ветку `main`/`master` и опубликованный стабильный тег `release/X.Y.Z`, `hotfix/X.Y.Z` либо старый `vX.Y.Z`. Команда создает коммит и пушит его в обе ветки. Сначала ознакомьтесь с [процессом релиза](./RELEASE.md) и [проверками команд](./README.md#preflight-проверки-по-командам).

Для `chart start` нужен Helm chart в `charts/<chart-name>/Chart.yaml`, верхний заголовок версии в его `CHANGELOG.md` и `GITLAB_PRIVATE_TOKEN` для проверки Helm-registry. Остальные требования конкретных команд описаны в [README.md](./README.md).
