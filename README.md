# 🚀 Spectrum CLI

Современный CLI для workflow разработки - переписанный с shell-скриптов на Node.js

## 📦 Установка

### 🌟 NPM (рекомендуется)

```bash
# Установить глобально
npm install -g spectrum-cli

# Использовать
spectrum --help
```

### 🔧 Из исходников

```bash
# Клонировать и установить
git clone https://github.com/dnwsilver/spectrum-cli.git
cd spectrum-cli
npm install
./index.js --help
```

📋 **Подробные инструкции**: [INSTALL.md](./INSTALL.md)

## 🚀 Использование

### Основные команды:

```bash
# Показать справку
spectrum --help
# Показать текущую версию CLI
spectrum -v | --version

# 🚀 Управление релизами
spectrum release start               # Схлопнуть fragments и атомарно отправить release commit в dev и main/master
spectrum release deploy              # Создать стабильный тег vX.Y.Z из заголовка CHANGELOG
spectrum release close               # Свести stable main/master в dev

# 📈 Теги chart
spectrum chart create 1.2.3  # Создать и запушить chart-$name-$version (требует запись в CHANGELOG.md чарта)
spectrum chart create 1.2.3 --wait   # После пуша тега дождаться публикации версии в Helm-registry
spectrum chart create 1.2.2 --force  # Разрешить версию не больше последней опубликованной
spectrum chart deploy  # Обновить helmrelease.yaml до последнего chart-тега и запушить
spectrum chart deploy --instances sd,cbch  # Обновить только выбранные инстансы instances/<name>
spectrum chart verify ~/repo  # Сравнить ingress paths AS IS vs TO BE для Next.js исходников

# 📝 Управление changelog
spectrum changelog append "Сообщение"  # Создать fragment в .changelog/
spectrum changelog check               # Проверить CHANGELOG.md и все fragments

# 🔑 GitLab токены
spectrum token rotate  # Пролить GITLAB_PRIVATE_TOKEN в CI variables
```

### Справка по командам:

```bash
# Справка по релизам
spectrum release --help

# Справка по changelog
spectrum changelog --help

# Справка по chart
spectrum chart --help

# Справка по токенам
spectrum token --help
```

## ✨ Особенности

- 🎯 **Минималистичный интерфейс** - только необходимые команды
- 🎨 **Цветной вывод** с эмодзи для лучшего UX
- 🔄 **Автоматическое определение** пакетного менеджера (npm/yarn/bun)
- 📊 **Детальная обратная связь** по каждой операции
- 🛡️ **Обработка ошибок** и fallback'ы
- 🚀 **Полная совместимость** с Git workflow

## 🔧 Требования

- Node.js >= 20
- Git

## 🏗️ Архитектура

```
spectrum-cli/
├── index.js           # 🚀 Главный CLI интерфейс
├── .changelog/        # 🧩 Независимые записи для следующего релиза
├── src/               # 📁 Исходный код
│   ├── utils.js       # 🛠️ Утилиты и логирование
│   ├── git.js         # 📝 Git операции
│   ├── version.js     # 📦 SemVer-хелперы (парсинг, сравнение, бамп)
│   ├── changelog-config.js # 🧩 Типы и правила changelog fragments
│   ├── changelog.js   # 📋 Создание и сборка changelog fragments
│   ├── chart.js       # 📈 Создание и push chart тегов
│   ├── token.js       # 🔑 Ротация GitLab PAT и CI variables
│   ├── development.js # ⚡ Dev команды (внутренние)
│   └── release.js     # 🚀 Release процесс
├── package.json       # 📦 Конфигурация проекта
├── install.sh         # 🔧 Автоматический установщик
├── INSTALL.md         # 📋 Инструкции по установке
└── README.md          # 📖 Документация
```

### Команды

| Команда                     | Описание                            |
| --------------------------- | ----------------------------------- |
| `spectrum release start`    | Схлопнуть и опубликовать fragments  |
| `spectrum release deploy`   | Создать стабильный тег vX.Y.Z       |
| `spectrum release close`    | Закрыть релиз                       |
| `spectrum changelog append` | Создать changelog fragment          |
| `spectrum changelog check`  | Проверить changelog и fragments     |
| `spectrum chart create`     | Создать и запушить chart тег        |
| `spectrum chart deploy`     | Обновить chart версию в helmrelease |
| `spectrum chart verify`     | Проверить ingress paths chart       |
| `spectrum token rotate`     | Пролить GITLAB_PRIVATE_TOKEN в CI   |

### 🛡️ Preflight-проверки по командам

- `spectrum release start`: чистая и актуальная dev-ветка, стабильный тег, достижимый из `origin/main` или `origin/master`, отсутствие в `CHANGELOG.md` незакрытых версий новее этого тега, валидные fragments и отсутствие целевых hotfix-веток и тега. Версия вычисляется только из тегов и fragments — `package.json` не читается.
- `spectrum release deploy`: чистая и актуальная main/master, стабильная версия `X.Y.Z` из верхнего заголовка `CHANGELOG.md`, отсутствие локального и remote-тега `vX.Y.Z`. Команда не создает RC-теги.
- `spectrum release close`: чистая и актуальная main/master, версия из верхнего заголовка `CHANGELOG.md` и remote-тег `vX.Y.Z`, указывающий на текущий commit.
- `spectrum changelog append <message>`: `git-repo`, `changelog-exists`, валидные ID задачи, git identity и тип fragment. Команда не изменяет общий `CHANGELOG.md`.
- `spectrum changelog check`: `git-repo`, `changelog-exists`, `changelog-prettier-check`, наличие и формат всех changelog fragments.
- `spectrum chart create <version>`: `git-repo`, `clean-working-tree`, `on-main-branch`, `valid-semver` (переданный `<version>` — semver), `single-chart` (ровно один `charts/<chart-name>/Chart.yaml`), `tag-missing` (тега `chart-<name>-<version>` нет локально и на `origin`).
- `spectrum chart deploy`: `git-repo`, `clean-working-tree`, `on-main-branch` (текущая ветка `main`), `remote-origin` (настроен `origin`), `remote-reachable` (доступен `origin`), `single-chart`, `helmrelease-files` (найдены `helmrelease.yaml`).
- `spectrum chart verify <source_path>`: `git-repo`, `single-values-yaml` (ровно один `charts/**/values.yaml`), `values-ingress-sections` (есть `ingress.paths.api/pages/assets`), `source-path-directory`, `next-project`, `build-command-support`.
- `spectrum token rotate`: `load-config` (есть валидный `~/.config/spectrum-cli/config.yaml`), `ask-tokens` (owner PAT и `GITLAB_PRIVATE_TOKEN` только в памяти), `check-access` (все группы и проекты доступны owner PAT).

## 🔄 Workflow релиза

### `spectrum release start`

Выполняется на `dev`:

1. Проверяет `CHANGELOG.md`, отсутствие релизов новее последнего стабильного тега и все файлы `.changelog/<name>.<type>.md`. Новый релиз нельзя начать, пока предыдущий не получил stable-тег.
2. После `git fetch origin --prune --tags` находит максимальный стабильный тег `vX.Y.Z`, достижимый из stable-ветки, и применяет к нему максимальное повышение: `breaking` → major, `added` → minor, остальные типы → patch.
3. Собирает новый релизный блок `## 🚀 [X.Y.Z]` в `CHANGELOG.md` из fragments в стабильном порядке разделов.
4. Удаляет использованные fragments.
5. Повторно проверяет формат `CHANGELOG.md`.
6. Коммитит схлопнутый changelog одним коммитом в `dev` и атомарно пушит этот commit напрямую в `origin/dev` и `origin/main` или `origin/master`, без Merge Request.

Команда не изменяет `package.json`, lock-файлы и не создает `release/*`-веток. Прямой push в stable-ветку должен быть разрешен правилами защиты репозитория; non-fast-forward обновление не выполняется.

### `spectrum release close`

1. Читает версию из верхнего заголовка `CHANGELOG.md` и проверяет, что стабильный `vX.Y.Z` уже указывает на текущий commit main/master.
2. Обновляет main/master и dev.
3. Мержит main/master в dev.
4. Пушит синхронизированный `dev`.

### `spectrum release deploy`

1. Проверяет актуальную main/master и читает версию `X.Y.Z` из верхнего заголовка `CHANGELOG.md`.
2. Создает единственный release-тег `vX.Y.Z`.
3. Пушит тег в `origin`. RC-теги CLI не создает.

### Цикл версий и CI

Источник правды о версии — git-тег `vX.Y.Z`. Файлы версий (`package.json`, `Makefile`) не читаются ни CLI, ни CI:

| Событие | Источник версии | Артефакт |
| --- | --- | --- |
| stable-тег `v1.0.0` | git-тег | `1.0.0` |
| коммиты в dev | тег `v1.0.0` + бамп из `.changelog/` | `1.1.0-alpha.SHORTSHA` |
| `release start` на dev | fragments схлопнуты в `## 🚀 [1.1.0]` | release commit в `dev` и `main/master` |
| merge в main/master | заголовок CHANGELOG `1.1.0` | `1.1.0-rc.1`, затем `rc.2`, ... |
| stable-тег `v1.1.0` | git-тег | проверенный RC продвигается в `1.1.0` |
| merge stable в dev (`release close`) | тег `v1.1.0` + бамп fragments | `X.Y.Z-alpha.SHORTSHA` |

Номер RC хранится в registry и переиспользуется при retry того же commit SHA.
Git содержит только стабильные теги `vX.Y.Z`. Stable pipeline проверяет OCI
revision обязательных образов и копирует точные RC digest без пересборки. Эту
CI-часть реализует подключенный release component, а не Spectrum CLI.

### `spectrum chart create <version>`

1. Ищет `Chart.yaml` в `charts/<chart-name>/Chart.yaml` и читает поле `name`
2. Проверяет, что текущая ветка — `main`
3. Проверяет semver для переданной версии
4. Собирает тег `chart-<name>-<version>`
5. Проверяет, что такого тега еще нет
6. Создает тег и пушит его в `origin`

### `spectrum chart deploy`

1. Находит последний тег чарта на remote `origin` в формате `chart-<app>-<version>`
2. Ищет все `helmrelease.yaml` в репозитории
3. Обновляет `spec.chart.spec.version` до найденной версии и печатает список файлов (`зеленым` обновленные, `серым` без изменений)
4. Если обновлений нет, завершает выполнение сообщением, что все уже на последней версии
5. Запрашивает подтверждение публикации через Enter
6. Делает `git add` обновленных файлов, создает коммит `🚀 Deploy service.` и пушит изменения

### `spectrum chart verify <source_path>`

1. Находит `charts/**/values.yaml` и читает `ingress.paths.api/pages/assets` как AS IS
2. Собирает TO BE для Next.js из `.next` артефактов, при необходимости запускает build, затем делает fallback на файловую структуру роутов
3. Для `assets` использует фиксированный набор regex-путей
4. Печатает diff только по изменениям: лишние пути (`-`) и недостающие (`+`) с цветовой подсветкой
5. Завершает команду с ошибкой, если есть расхождения

### `spectrum token rotate`

Пролив уже созданного PAT `GITLAB_PRIVATE_TOKEN` в CI/CD variables групп и проектов. Команда токен не выпускает.

**Конфиг:** `~/.config/spectrum-cli/config.yaml`

Если файла нет, команда создаст его:

```yaml
bot: bot
token_ttl_months: 12
groups: []
projects: []
```

- `bot` и `token_ttl_months` читаются только из конфига.
- Скрытым вводом запрашиваются два токена. Оба живут только в памяти.
- Owner PAT: ходит в API, проверяет доступ, читает/удаляет/создает CI variables. Для групп нужен Owner, для проектов — Maintainer+.
- `GITLAB_PRIVATE_TOKEN`: только значение, которое пишется в CI variable.
- Для каждой группы и проекта CI variable `GITLAB_PRIVATE_TOKEN` удаляется (если есть) и создается заново как masked and hidden.
- Description переменной: `PAT от бота <bot>, владелец Колосов. Истекает YYYY-MM-DD.` Дата = сегодня + `token_ttl_months`.

1. Загружает или создает конфиг
2. Запрашивает owner PAT
3. Запрашивает `GITLAB_PRIVATE_TOKEN`
4. Проверяет доступ ко всем группам и проектам owner PAT
5. Обновляет CI variables во всех целях

## 📝 Работа с Changelog

### `spectrum changelog append "Сообщение"`

Команда создает независимый файл `.changelog/<task>-<branch>.<type>.md`. Разработчики больше не редактируют общий блок `Unreleased`, поэтому параллельные ветки не конфликтуют в `CHANGELOG.md`.

Рабочая ветка должна полностью соответствовать `<type>/<YOUTRACK-ID>` или
`<type>/<YOUTRACK-ID>-<slug>`, например `feature/AR-123` или
`bugfix/ABBVJSOP-1-timeout`. YouTrack ID начинается сразу после первого `/` и
соответствует `[A-Z]+-[0-9]+`; отсутствующий ID больше не запрашивается
интерактивно и не придумывается.

**✨ Основные возможности:**
- 🔍 **Автоматическое извлечение** номера задачи из названия ветки
- 🧭 **Строгая проверка** GitFlow-префикса и YouTrack ID в имени ветки
- 👤 **Проверка Git config** с подсказками по настройке
- 🎯 **Умное определение раздела** по типу ветки
- 🧩 **Дополнение существующего fragment** той же задачи без дублирования строк
- 🔀 **Автоматическая сборка** общего changelog во время `spectrum release start`

**📋 Поддерживаемые типы веток:**
- `feature/`, `feat/` → выбор между Breaking change, Added, Changed, Deprecated, Removed
- `bugfix/`, `fix/` → автоматически Fixed
- `support/` → выбор между Support, Security
- другие → показ всех разделов

**📋 Типы fragment и SemVer:**

| Суффикс | Раздел | Повышение версии |
| --- | --- | --- |
| `breaking` | Breaking change | major |
| `added` | Added | minor |
| `changed`, `deprecated`, `removed` | Соответствующий раздел | patch |
| `fixed`, `security`, `support` | Соответствующий раздел | patch |

**📌 Пример использования:**

```bash
# На ветке feature/ABC-123-new-component
spectrum changelog append "Добавлен новый компонент кнопки"

# Результат:
# .changelog/ABC-123-feature-new-component.added.md
# - ABC-123 Добавлен новый компонент кнопки. [Ваше Имя](ваш@email.com)
```

Fragment должен содержать только непустые Markdown-строки, начинающиеся с `- `. Один fragment может содержать несколько записей одного типа. Fragment коммитится вместе с изменением и удаляется только автоматикой релиза.

### `spectrum changelog check`

Команда предназначена для локальной и CI-проверки перед merge:

- проверяет формат `CHANGELOG.md` через Prettier;
- требует хотя бы один fragment в `.changelog/`;
- проверяет имя `<name>.<type>.md`, поддерживаемый тип и формат каждой строки;
- не изменяет файлы.

> Совет: Приведите файл к нужному формату командой:
>
> ```bash
> npx --yes prettier --write CHANGELOG.md
> ```

## 🎯 Философия

- **Простота** - минимум команд, максимум функциональности
- **Безопасность** - все операции с обработкой ошибок
- **Скорость** - быстрые операции без лишних зависимостей
- **Читаемость** - понятные логи и сообщения

## 📚 Дополнительная документация

- 📋 **[Установка](./INSTALL.md)** - подробные инструкции по установке
- 🚀 **[Релизы](./RELEASE.md)** - инструкции по выпуску новых версий

## 🤝 Участие в разработке

```bash
# Форк репозитория
git clone https://github.com/dnwSilver/spectrum-cli.git
cd spectrum-cli

# Установка dev зависимостей
npm install

# Тестирование
./index.js --help
```

## 📄 Лицензия

MIT License - см. [LICENSE](./LICENSE)

---

_Создано для автоматизации повседневных задач разработки_ 🛠️
