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

Перед выполнением команд workflow CLI проверяет опубликованную версию `spectrum-cli`
в npm Registry. Если доступна новая версия, показывает текущую и новую версии и
команду `spectrum upgrade`. Она запускает `npm install -g spectrum-cli`.
Проверка ограничена 200 мс; недоступность Registry не влияет на выполнение
команды и не выводит ошибку. С `--dry` или `--no-verify` проверка обновлений
не выполняется.

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
spectrum -v  # или spectrum --version

# Обновить установленный CLI
spectrum upgrade

# 🚀 Управление релизами
spectrum release start [--stable]    # Схлопнуть fragments и атомарно отправить release commit в dev и main/master
spectrum release deploy              # Создать стабильный тег release/X.Y.Z из заголовка CHANGELOG
spectrum release close               # Свести stable main/master в dev

# Срочный patch без переноса незавершённого dev в production
spectrum hotfix start                # Локальная подготовка 🩹 CHANGELOG на hotfix/* или main/master
spectrum hotfix deploy               # После merge MR: stable-тег на актуальном main/master
spectrum hotfix close                # После stable pipeline: main/master → dev

# 📈 Теги chart
spectrum chart start         # Создать тег по CHANGELOG.md чарта и дождаться публикации в Helm-registry
spectrum chart start --no-wait # Не ждать публикации после отправки тега
spectrum chart start --force # Разрешить версию не выше последнего remote-тега, если ее еще нет в registry и Git
spectrum chart deploy  # Обновить helmrelease.yaml до последнего chart-тега и запушить
spectrum chart deploy --instances sd,cbch  # Обновить только выбранные инстансы instances/<name>
spectrum chart verify ~/repo  # Сравнить ingress paths AS IS vs TO BE для Next.js исходников

# 📝 Управление changelog
spectrum changelog append "Сообщение"  # Создать fragment в .changelog/
spectrum changelog check               # Проверить CHANGELOG.md и все fragments
spectrum changelog write               # Выравнять заголовки CHANGELOG.md и запустить Prettier

# 🔑 GitLab токены
spectrum token rotate  # Пролить SC_BOT_PAT в CI variables

# CI: Next.js, SBOM и security
spectrum nextjs licenses
spectrum sbom catalog resolve
spectrum sbom catalog populate
spectrum security scan
spectrum security track
spectrum security reconcile
spectrum security repair
```

По умолчанию команды с действием показывают, какая предпроверка успешно пройдена;
при ошибке выводят её имя и причину. Независимые предпроверки продолжают
выполняться после ошибки; зависимые проверки без нужных данных помечаются как
невыполненные. Шаги команды запускаются, только если все проверки прошли.

`-n, --no-verify` доступен во всех 21 командах с действием: пропускает
preflight и проверку обновлений CLI, затем запускает действия команды.
Чтение необходимых входных данных (версии, fragments, пути, конфигурация,
токены) остаётся частью подготовки к действию. Ошибки чтения и самих операций
по-прежнему останавливают выполнение. Флаг не отменяет выбор типа fragment,
запрос токенов, подтверждение публикации chart или ожидание registry.
Для отключения ожидания у `chart start` отдельно укажите `--no-wait`.
Прежний короткий флаг `chart start -n` теперь означает `--no-verify`.
Release/hotfix используют локальные теги и сохранённые refs `origin/*`
для определения базовой версии, без preflight fetch и сверки с сервером.
`release start -n` дополняет верхний версионный раздел, если он новее локальной
stable-версии. Число и порядок более старых разделов не проверяются;
их содержимое сохраняется без пересборки.

```bash
spectrum release start -n
spectrum chart start --no-verify --no-wait
spectrum security repair -ns
```

`--dry` и `--no-verify` несовместимы: CLI завершится с ошибкой до действий.
Без `--no-verify` сохраняются обычные предпроверки.

`-s, --silence` скрывает сообщения об успешно пройденных предпроверках.
Ошибки проверок и итоговое сообщение команды остаются видны; флаг можно
совмещать с `-d, --dry`.
`-d, --dry` выполняет все предпроверки,
показывает их результаты и не запускает шаги записи, создания тегов,
публикации или деплоя. Предпроверки могут обращаться к `origin`, registry и
GitLab; `token rotate -d` запрашивает токены и проверяет доступ к целям, но не
изменяет CI variables. Если конфиг токенов отсутствует, `--dry` завершится
ошибкой и не создаст его. Для `upgrade -d` предпроверок нет: команда сообщает
об успехе, не запуская npm.

| Короткий флаг | Полный флаг | Где действует |
| --- | --- | --- |
| `-d` | `--dry` | Все команды с действием: только предпроверки |
| `-s` | `--silence` | Все команды с действием: скрыть успешные предпроверки |
| `-f` | `--force` | `chart start`: разрешить версию не больше последнего тега на `origin`; остальные preflight сохраняются, если не задан `--no-verify` |
| `-n` | `--no-verify` | Все команды с действием: пропустить preflight и сразу выполнить действия |
| — | `--no-wait` | `chart start`: не ждать появления версии в Helm-registry после push; по умолчанию команда ждёт |
| — | `--stable` | `release start`: переход с 0.x на 1.0.0 |
| `-i <names>` | `--instances <names>` | `chart deploy`: выбрать инстансы через запятую |
| `-h` | `--help` | Справка CLI и команд |
| `-v` | `--version` | Версия CLI |

### Справка по командам:

```bash
# Справка по релизам
spectrum release --help

# Справка по хотфиксам
spectrum hotfix --help

# Справка по changelog
spectrum changelog --help

# Справка по chart
spectrum chart --help

# Справка по токенам
spectrum token --help

# Справка по CI-командам
spectrum nextjs --help
spectrum sbom catalog --help
spectrum security --help
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
├── index.js             # Точка входа CLI
├── .changelog/          # Записи для следующего релиза
├── src/
│   ├── cli/             # Команды, справка и запуск действий
│   ├── common/          # Общие утилиты и версии
│   ├── git/             # Git операции
│   ├── preflight/       # Независимые предпроверки по областям
│   ├── changelog/       # Fragments, конфиг и релизные разделы
│   ├── chart/           # Метаданные, теги, registry, verify и deploy
│   ├── release/         # Версии и этапы обычного релиза
│   ├── hotfix/          # Проверки и этапы hotfix
│   ├── token/           # Конфиг, GitLab API и ротация
│   ├── integrations/    # Общие функции внешних сервисов
│   ├── automation/      # Общие операции ввода-вывода для CI
│   ├── nextjs/          # LICENSE standalone-пакетов
│   ├── sbom/            # Поиск и публикация OCI-каталогов
│   └── security/        # Аудит, задачи и исправления
├── __tests__/           # Модульные и интеграционные тесты
├── package.json
├── install.sh
├── INSTALL.md
└── README.md
```

Входы модулей находятся в `index.js` соответствующих каталогов. Например,
`require('./src/chart')` загружает `src/chart/index.js`; в корне `src` файлов нет.

### Команды

Ниже перечислены все команды с действием из `spectrum --help` и справки
вложенных групп. Каждая поддерживает `-n, --no-verify`, `-d, --dry` и
`-s, --silence`.

| Команда | Аргументы и дополнительные опции | Назначение |
| --- | --- | --- |
| `spectrum upgrade` | — | Обновить CLI через npm |
| `spectrum release start` | `--stable` | Собрать fragments и отправить release commit в dev и main/master |
| `spectrum release deploy` | — | Создать и отправить стабильный тег `release/X.Y.Z` |
| `spectrum release close` | — | Свести main/master в dev |
| `spectrum hotfix start` | — | Подготовить hotfix CHANGELOG локально |
| `spectrum hotfix deploy` | — | Отправить тег `hotfix/X.Y.Z` после merge в production |
| `spectrum hotfix close` | — | Свести production в dev после stable pipeline |
| `spectrum changelog append` | `<message>` | Создать changelog fragment |
| `spectrum changelog check` | — | Проверить CHANGELOG.md и fragments |
| `spectrum changelog write` | — | Нормализовать заголовки и отформатировать CHANGELOG.md |
| `spectrum chart start` | `-f, --force`, `--no-wait` | Создать и отправить chart-тег, дождаться registry |
| `spectrum chart deploy` | `-i, --instances <names>` | Обновить helmrelease и опубликовать изменения |
| `spectrum chart verify` | `<source_path>` | Сравнить ingress paths с маршрутами Next.js |
| `spectrum token rotate` | — | Пролить `SC_BOT_PAT` в CI variables |
| `spectrum nextjs licenses` | — | Сохранить LICENSE compiled-пакетов в standalone |
| `spectrum sbom catalog resolve` | — | Найти OCI-каталоги зависимостей образа |
| `spectrum sbom catalog populate` | — | Построить и опубликовать OCI-каталоги |
| `spectrum security scan` | — | Проверить npm-зависимости и runtime |
| `spectrum security track` | — | Найти или создать задачи YouTrack |
| `spectrum security reconcile` | — | Запустить tracker и получить номера задач |
| `spectrum security repair` | — | Исправить зависимости, проверить и создать MR |

### 🛡️ Preflight-проверки по командам

Этот список описывает запуск без `--no-verify`.

- `spectrum release start`: чистая и актуальная dev-ветка, `dev` содержит `origin/main` или `origin/master`, стабильный тег, достижимый из production-ветки, согласованная опубликованная история `CHANGELOG.md` и не более одного открытого релиза. При первом запуске нужны валидные fragments и свободная версия; повторный дополняет открытый раздел без повышения версии. `package.json` не читается.
- `spectrum release deploy`: чистая и актуальная main/master, стабильная версия `X.Y.Z` из верхнего заголовка `CHANGELOG.md`, отсутствие этой версии среди локальных и remote-тегов всех трёх форм. Команда не создает RC-теги.
- `spectrum release close`: чистая и актуальная main/master, версия из верхнего заголовка `CHANGELOG.md` и remote stable-тег поддерживаемой формы, указывающий на текущий commit.
- `spectrum changelog append <message>`: `git-repo`, `changelog-exists`, валидные ID задачи, git identity и тип fragment. Команда не изменяет общий `CHANGELOG.md`.
- `spectrum changelog check`: `git-repo`, `changelog-exists`, `changelog-prettier-check`, наличие и формат всех changelog fragments. С `--no-verify` команда завершается без проверок.
- `spectrum changelog write`: `git-repo`, `changelog-exists`, доступность Prettier.
- `spectrum chart start`: `git-repo`, `clean-working-tree`, `on-main-branch`, `single-chart` (ровно один `charts/<chart-name>/Chart.yaml`), валидный верхний SemVer-заголовок в `charts/<chart-name>/CHANGELOG.md`, отсутствие тега `chart-<name>-<version>` локально и на `origin`, отсутствие этой версии чарта в Helm-registry. Для запроса registry нужен `SC_DEVELOPER_PAT` (PAT со scope `api` и доступом к проекту; роль Owner не требуется); ошибка доступа блокирует команду. Право отправки chart-тега определяется отдельно правилами protected tags. `-f, --force` обходит только проверку повышения версии относительно последнего remote-тега. После push команда по умолчанию ждёт версию в registry; `--no-wait` отключает ожидание.

Для обратной совместимости chart-команды принимают `SC_OWNER_PAT`, если
`SC_DEVELOPER_PAT` не задана или пуста. `SC_OWNER_PAT` deprecated: поддержка
будет удалена в следующей версии. При её использовании CLI один раз за процесс
выводит предупреждение с просьбой перейти на `SC_DEVELOPER_PAT`. Если заданы обе
переменные, используется `SC_DEVELOPER_PAT` без предупреждения.

- `spectrum chart deploy`: `git-repo`, `clean-working-tree`, `on-main-branch` (текущая ветка `main/master`), `branch-up-to-date`, `remote-origin` (настроен `origin`), `remote-reachable` (доступен `origin`), `single-chart`, `helmrelease-files` (найдены `helmrelease.yaml`).
- `spectrum chart verify <source_path>`: `git-repo`, `branch-up-to-date`, `single-values-yaml` (ровно один `charts/**/values.yaml`), `values-ingress-sections` (есть `ingress.paths.api/pages/assets`), `source-path-directory`, `next-project`, `build-command-support`.
- `spectrum token rotate`: `load-config` (есть валидный `~/.config/spectrum-cli/config.yaml`), `ask-tokens` (owner PAT и `SC_BOT_PAT` только в памяти), `check-access` (все группы и проекты доступны owner PAT).

## 🔄 Workflow релиза

### `spectrum release start`

Выполняется на `dev`:

1. Проверяет чистую актуальную dev-ветку, включающую `origin/main` или `origin/master`, changelog и fragments.
2. После `git fetch origin --prune --tags` находит максимальный stable-тег среди `release/X.Y.Z`, `hotfix/X.Y.Z` и `vX.Y.Z`, достижимый из production-ветки.
3. Если открытого релиза нет, вычисляет версию по fragments. До `1.0.0`: `breaking`, `removed` и `added` → minor, остальные → patch. Начиная с `1.0.0`: `breaking` и `removed` → major, `added` → minor, остальные → patch. Если раздел уже открыт в main/master, сохраняет его версию и дату, объединяет прежние записи с новыми по разделам без дублей. Тип новых fragments не повышает уже выбранную версию.
4. Форматирует и проверяет `CHANGELOG.md`, затем удаляет использованные fragments.
5. Коммитит изменения и атомарно пушит dev в `origin/dev` и `origin/main` или `origin/master`, без Merge Request. Если новых записей нет, пустой коммит не создаётся; можно повторить отправку после её сбоя.

Первый стабильный выпуск создаётся явно: `spectrum release start --stable`
вычисляет ровно `1.0.0` от опубликованного `0.x`. Другой открытый релиз блокирует
переход; повтор подготовки открытого `1.0.0` допустим. Флаг запрещён после
перехода на `1.x`. Он выполняет обычный workflow `release start`, включая commit
и push; `--dry` запускает только предпроверки. Обычный запуск от `0.3.7` с
breaking/removed даёт `0.4.0`, с исправлением — `0.3.8`; исходные типы записей
сохраняются. Alpha CI должен применять ту же политику к своей базовой версии.

Сброс прежней высокой нумерации на `0.x` не выполняется этой командой: это
отдельная миграция с архивом changelog и ссылок тегов, согласованием dev/master и
исключением старых тегов из расчёта версии. Нельзя запускать `release start`,
пока опубликованная история в dev и production различается.

Например, повторный `release start` дополняет открытый `1.4.0`; после публикации
`release/1.4.0` новые fragments уже формируют следующий релиз. Изменение
опубликованной истории и конфликтующие открытые версии блокируют команду.

Команда не изменяет `package.json`, lock-файлы и не создает `release/*`-веток. Прямой push в stable-ветку должен быть разрешен правилами защиты репозитория; non-fast-forward обновление не выполняется.

### `spectrum release close`

1. Читает версию из верхнего заголовка `CHANGELOG.md` и проверяет, что remote stable-теги этой версии указывают на текущий commit main/master.
2. Обновляет main/master и dev.
3. Мержит main/master в dev.
4. Пушит синхронизированный `dev`.

### `spectrum release deploy`

1. Проверяет актуальную main/master и читает версию `X.Y.Z` из верхнего заголовка `CHANGELOG.md`.
2. Создает единственный release-тег `release/X.Y.Z`.
3. Пушит тег в `origin`. RC-теги CLI не создает.

### Формат стабильных тегов

Новые обычные релизы получают `release/X.Y.Z`, хотфиксы — `hotfix/X.Y.Z`.
Старый `vX.Y.Z` эквивалентен `release/X.Y.Z`: он участвует в поиске последней
версии и проверке занятости номера. Старые теги не нужно переименовывать.
Нумерация общая: после `release/1.2.3` и `hotfix/1.2.4` следующий patch — `1.2.5`.
Выпустить занятый номер под другим префиксом нельзя. В changelog и версиях
образов остаётся `X.Y.Z`, без `release/` и `hotfix/`. Это имена **тегов**, не веток.

Все hotfix-команды сначала проверяют ветку: разрешены только `hotfix/*`, `main`
или `master`. `dev`, `develop`, `feature/*` и detached HEAD отклоняются до fetch.
Для `start` подходят `hotfix/<TASK>[-slug]` и production-ветка `main/master`,
содержащая актуальный origin. Локальные исправления и commits допустимы.
`deploy` и `close` требуют чистый production commit, совпадающий с origin.

### Изолированный цикл хотфикса

Создайте `hotfix/<TASK>` или `hotfix/<TASK>-<slug>` от актуального `origin/main`
или `origin/master`, либо работайте прямо в актуальной production-ветке
`main/master`. Включайте только срочное исправление и его patch fragments
(`fixed`, `security`, `support` либо другой совместимый patch-тип).
`added`, `breaking` и `removed` требуют обычного релиза. Все команды запускаются из корня
репозитория; для `start` нужен Prettier, как для обычной сборки changelog.

1. **`spectrum hotfix start`** обновляет сведения об origin и выбирает опубликованный
   stable-тег, достижимый из production. Цель — этот stable плюс один patch.
   Как и `release start`, команда читает все файлы текущей `.changelog/` независимо
   от того, когда они попали в Git. Проверяет их общими правилами changelog и
   допускает только patch-типы; файлы `added`, `breaking` и `removed` требуют обычного релиза.
   Формат CHANGELOG.md проверяется только в текущей ветке. История может отличаться
   от stable-тега: её исправления не блокируют хотфикс. Снимок production используется
   для сохранения записей уже подготовленного хотфикса, без строгой проверки старых заголовков.
   Команда формирует верхний раздел `## 🩹 [X.Y.Z] - YYYY-MM-DD` и удаляет только
   собранные fragments. Она не делает commit, staging, push, merge или tag,
   не меняет файлы версий и сохраняет посторонние локальные изменения.
2. Повторный `start` дополняет тот же неопубликованный раздел, сохраняя дату и
   существующие записи без дублей. Дата необязательна: раздел без даты останется
   без даты. Старые заголовки с `🚀`, `🩹`, без значка и с датами через точки
   читаются без переписывания опубликованной истории. Без новых fragments подготовленный раздел
   остаётся без изменений. Например, от `v6.35.0` первый и повторные запуски
   готовят `6.35.1`; только после публикации `hotfix/6.35.1` следующий хотфикс получит
   `6.35.2`.
3. Проверьте diff, закоммитьте и отправьте исправление по правилам проекта.
   **В MR из hotfix в production уже должны быть верхний patch-раздел и удаления
   использованных fragments.** Merge выполняется отдельно после ревью. Если
   другой хотфикс уже в production, сначала перенесите его изменения в свою
   ветку и повторите подготовку: пока stable-тега нет, раздел и версия общие.
4. После доставки подготовленного исправления в production через MR или
   разрешённый проектом push и проверки RC выполните **`spectrum hotfix deploy`** на чистом
   `main/master`, точно совпадающем с origin. Команда проверяет следующий patch,
   отсутствие несобранных hotfix fragments,
   создаёт `hotfix/X.Y.Z` на проверенном SHA и отправляет **только этот тег**.
   Повтор после ошибки push допускает существующий локальный тег лишь на том же
   SHA; опубликованный тег не перемещается. Ветки не сливаются.
5. После успешного stable pipeline выполните **`spectrum hotfix close`** на том же
   чистом production commit с тегом `hotfix/X.Y.Z`. Команда обновит `dev/develop` только
   fast-forward, смержит production в integration и отправит integration.
   Незавершённая работа и fragments в dev сохраняются. Локальные неопубликованные
   commits блокируют автоматическую отправку; конфликт остаётся для ручного
   разрешения, без push. При неуспешном push готового merge проверьте локальный
   diff и согласуйте ветку вручную — повторный `close` не отправляет локальные
   commits без проверки.

CLI не проверяет статус CI и не управляет кластером: проверка RC, успешного stable
pipeline и фактического выката выполняется отдельно в системе доставки. Обычный
`release start` не используется в этом цикле: он отправляет integration в production.
`changelog check` проверяет исходные fragments до сборки; после сборки сам `hotfix start`
проверяет подготовленный раздел. CI проекта должен принимать собранные заметки в MR,
не требуя повторного fragment для уже включённой записи.

### Цикл версий и CI

Источник версии — Git-теги `release/X.Y.Z`, `hotfix/X.Y.Z` и legacy `vX.Y.Z`. Файлы версий (`package.json`, `Makefile`) не читаются ни CLI, ни CI:

| Событие | Источник версии | Артефакт |
| --- | --- | --- |
| stable-тег `v1.0.0` | git-тег | `1.0.0` |
| коммиты в dev | тег `v1.0.0` + бамп из `.changelog/` | `1.1.0-alpha.SHORTSHA` |
| `release start` на dev | fragments схлопнуты в `## 🚀 [1.1.0]` | release commit в `dev` и `main/master` |
| merge в main/master | заголовок CHANGELOG `1.1.0` | `1.1.0-rc.1`, затем `rc.2`, ... |
| stable-тег `release/1.1.0` | git-тег | проверенный RC продвигается в `1.1.0` |
| merge stable в dev (`release close`) | тег `release/1.1.0` + бамп fragments | `X.Y.Z-alpha.SHORTSHA` |

Номер RC хранится в registry и переиспользуется при retry того же commit SHA.
Новые stable-теги — `release/X.Y.Z` и `hotfix/X.Y.Z`; старые `vX.Y.Z` сохраняются. Stable pipeline проверяет OCI
revision обязательных образов и копирует точные RC digest без пересборки. Эту
CI-часть реализует подключенный release component, а не Spectrum CLI.

### `spectrum chart start`

1. Ищет `Chart.yaml` в `charts/<chart-name>/Chart.yaml` и читает поле `name`
2. Проверяет, что текущая ветка — `main`
3. Читает версию из верхнего заголовка `charts/<chart-name>/CHANGELOG.md` и проверяет SemVer
4. Собирает тег `chart-<name>-<version>`
5. Проверяет, что такого тега еще нет локально и на `origin`, а версия отсутствует в Helm-registry
6. Создает тег и пушит его в `origin`, затем ждёт появления версии в registry; `--no-wait` отключает ожидание

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

Пролив уже созданного PAT `SC_BOT_PAT` в CI/CD variables групп и проектов. Команда токен не выпускает.

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
- `SC_BOT_PAT`: только значение, которое пишется в CI variable.
- Для каждой группы и проекта CI variable `SC_BOT_PAT` удаляется (если есть) и создается заново как masked and hidden.
- Description переменной: `PAT от бота <bot>, владелец Колосов. Истекает YYYY-MM-DD.` Дата = сегодня + `token_ttl_months`.

1. Загружает или создает конфиг
2. Запрашивает owner PAT
3. Запрашивает `SC_BOT_PAT`
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

| Суффикс | Раздел | До `1.0.0` | С `1.0.0` |
| --- | --- | --- | --- |
| `breaking` | Breaking change | minor | major |
| `removed` | Removed | minor | major |
| `added` | Added | minor | minor |
| `changed`, `deprecated` | Соответствующий раздел | patch | patch |
| `fixed`, `security`, `support` | Соответствующий раздел | patch | patch |

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
> spectrum changelog write
> ```

### `spectrum changelog write`

Команда приводит все релизные заголовки `CHANGELOG.md` к виду `## 🚀 [X.Y.Z]`,
`## 🩹 [X.Y.Z]` или `## [X.Y.Z]` с необязательной датой, затем запускает Prettier.
Старые даты через точки и текст записей сохраняются. Неверный заголовок, включая
`Unreleased`, останавливает команду без удаления записей. При ошибке Prettier
исходный `CHANGELOG.md` восстанавливается. Файлы `.changelog/` команда не меняет;
commit и push не выполняет.

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

## Команды для CI: Next.js, SBOM и security

Начиная с 5.1.0 логика команд написана на JavaScript и входит в npm-пакет.
Команды не задают вопросов и не проверяют обновления CLI. Они не запускают
release/hotfix preflight, рассчитанный на интерактивную работу разработчика.

| Команда | Назначение | Результат |
| --- | --- | --- |
| `spectrum nextjs licenses` | Сохранить исходные LICENSE уже включённых compiled-пакетов Next.js | JSON summary в stdout; код 2 при неполном результате |
| `spectrum sbom catalog resolve` | Найти Next в immutable образе, проверить OCI-каталоги, запросить отсутствующие версии | `sbom-catalog/<prefix>/{selection.json,report.json,report.md}` |
| `spectrum sbom catalog populate` | Построить каталог по официальному npm tarball и историческому Git tree | `sbom-catalog-updater/{report.json,report.md}` |
| `spectrum security scan` | Проверить `npm audit --omit=dev`, runtime и фактическую версию Node | `security-report/findings.json`, raw evidence, `scan.env` |
| `spectrum security reconcile` | Запустить центральный tracker и получить ссылки на задачи | `security-report/tracked.json` |
| `spectrum security track` | Найти/создать общие CVE и проектные задачи | `security-report/tracked.json` в центральном pipeline |
| `spectrum security repair` | Исправить одну проектную задачу за MR, выполнить проверки и повторный аудит | `security-report/{final.json,message.json}` |

Код 0 означает успешное выполнение, 1 — ошибку security/запуска, 2 — неполный
результат SBOM или LICENSE. Команды работают в текущем каталоге. Отсутствующие
credentials/некорректные отчёты приводят к ошибке, а не к чистому аудиту.
Автоматическое слияние MR отключено; сетевые записи не повторяются вслепую.

Компоненты передают свои inputs через job-local окружение. `security scan`
читает `NIGHTLY_YOUTRACK_PROJECT`, `NIGHTLY_YOUTRACK_TIME_TRACKING_ARTICLE`,
`NIGHTLY_YOUTRACK_TESTER`, необязательный `NIGHTLY_YOUTRACK_SUBSYSTEM`,
`NIGHTLY_DOCKERFILE`, `NIGHTLY_PLATFORMS` и `NIGHTLY_CHECK_COMMANDS` (JSON argv).
Токены `GLAB_BOT_PAT` и `YOUTRACK_PRIVATE_TOKEN` остаются секретными CI variables;
YouTrack-токен нужен только центральному tracker. Для registry используются
`NEXUS_USER`/`NEXUS_PASSWORD` либо стандартные CI registry credentials.
Секреты автоматизации исключаются из окружения выполняемых проверок проекта.

`sbom catalog resolve` читает `SBOM_CATALOG_CLIENT_ENABLED=true`,
`SBOM_CATALOG_FRAMEWORK=nextjs`, `SBOM_CATALOG_PREFIX` (по умолчанию `site:`),
`SBOM_CATALOG_REPOSITORY`, `DOCKER_IMAGE`, `APP_VERSION` и стандартные GitLab
`CI_*` variables. Чтение каталога использует `SBOM_CATALOG_USER` и
`SBOM_CATALOG_PASSWORD`, если заданы. `populate` требует защищённый `main`,
`NEXT_CATALOG_VERSIONS` (JSON-массив 1..10 точных версий) и центральные
`NEXUS_USER`/`NEXUS_PASSWORD`. Namespace записи задаёт только доверенная
project variable `SBOM_CATALOG_PUBLISH_REPOSITORY`.

Внешние инструменты: Linux amd64 для SBOM bootstrap; Git для каталога,
Trivy/Skopeo/Buildah для runtime-аудита и исправлений. SBOM-команды скачивают
закреплённые ORAS/Syft с проверкой SHA-256, ограничениями размера и времени.
Python для этих команд не требуется. Они не выполняют код из npm tarball
или upstream build-рецептов. Неоднозначное происхождение остаётся unresolved.
Поля CVE, Severity, Priority и Type=Group проверяются до создания подзадач;
CRITICAL получает Stopper (Неотложная), HIGH — Critical (Критическая).

Образы и адреса сервисов задаёт CI-конфигурация конкретной установки.
CLI не содержит дефолтов для YouTrack, registry или внутренних GitLab-проектов.
Само наличие команды `track` не сериализует процессы: job должен оставаться
в одном центральном проекте с `resource_group: nightly-youtrack-global`.
Отдельный consumer lock `nightly-security-fix` защищает исправления проекта.

Для проверки миграции:

```sh
npm ci
npm test -- --runInBand
npm pack --dry-run
```

Тесты используют локальные Git-репозитории и fake API. Зафиксированные parity
fixtures получены из прежнего Python-кода; исполняемый Python в пакет не входит.
Публикация CLI, образов, компонентов и запуск живого pipeline — отдельные шаги.

### npm registry и проверка runtime

`NIGHTLY_NPM_REGISTRY` задаёт доверенный HTTPS registry для npm-команд ночного процесса. При наличии
`NEXUS_USER` / `NEXUS_PASSWORD` CLI создаёт временный `.npmrc` с BASIC auth, ограниченной host/path этого registry.
Существующий user config сохраняется, исходный файл не меняется. Временный файл имеет права `0600`, удаляется
после команды и не входит в отчёт. URL registry передаётся CI-компонентом; значения инфраструктуры в CLI не зашиты.
Ошибки npm сохраняют HTTP-код и причину, при этом credentials удаляются из диагностических сообщений.

Для версии Node из runtime нужны Skopeo, umoci и chroot. CLI копирует выбранную платформу immutable OCI-образа,
распаковывает rootfs в rootless-режиме и запускает только настроенный Node binary с `--version` от uid/gid 65534.
Проверка требует доступный chroot (`CAP_SYS_CHROOT`), но не Buildah user/mount namespaces. Кросс-платформенный запуск
требует binfmt/QEMU. Buildah нужен для пересборки runtime при автоматическом исправлении; отсутствие его нужных
возможностей блокирует публикацию такого исправления и отражается в отчёте.

### Preflight для команд автоматизации

Обязательные deployment-настройки задаются явно:

| Команда | Настройки |
| --- | --- |
| `security track` | `YOUTRACK_URL`, `YOUTRACK_PRIVATE_TOKEN`, `CI_API_V4_URL`, `GLAB_BOT_PAT`, идентификаторы consumer job/project и component SHA |
| `security reconcile` | `NIGHTLY_TRACKER_PROJECT`, `NIGHTLY_COMPONENT_SHA`, `NIGHTLY_SCAN_JOB_ID`, `CI_PROJECT_ID`, GitLab API/token; при пустом отчёте сеть не нужна |
| `security repair` | GitLab API/token и результаты scan/tracking; при пустом отчёте запись и проверка токена не нужны |
| `sbom catalog resolve` | `SBOM_CATALOG_REPOSITORY`, `DOCKER_IMAGE`, `APP_VERSION`; `SBOM_CATALOG_UPDATER_PROJECT` для запроса отсутствующих версий |
| `sbom catalog populate` | `SBOM_CATALOG_PUBLISH_REPOSITORY`, `NEXUS_USER`, `NEXUS_PASSWORD`, защищённый main и точные `NEXT_CATALOG_VERSIONS` |
| `security scan/repair` с `NEXUS_*` | Дополнительно явный `NIGHTLY_REGISTRY_HOSTS`; один логин без пароля или наоборот считается ошибкой |

В GitLab выполняются GET `/user`, `/personal_access_tokens/self` и чтение
целевых проектов. Проверяются активность токена, scope `api` для записи
(`api`/`read_api` для чтения), эффективная роль Developer/Reporter и состояние
проекта. Fine-grained/прочие токены, для которых introspection не подтверждает
эти scope, не считаются проверенными. Защита веток/тегов дополнительно
проверяется сервером при конкретной операции.

В YouTrack выполняются GET `/users/me`, чтение двух проектов, их полей и
поиск задач. До создания первой задачи проверяются активность пользователя,
доступность проектов и обязательные поля. Ответы 401/403, недоступность и
неверный TLS приводят к ошибке с названием проверки; секреты/тела ответов
не выводятся. Инспекция полей не требует тестового изменения проекта.

Writer выполняет ORAS login и чтение точного namespace до скачивания исходников
и построения каталога. Preflight сохраняется в отчёте. Чтение/логин не доказывают
права Create/Update/Link Issue, доступ к приватным полям, workflow-переходам или
registry push: эти права проверяются соответствующими операциями. Они явно
помечены `checked_by_operations`/`checked_by_publish`, без ложного статуса
«запись проверена». Preflight не создаёт задач, MR, upload-сессий или пробных
каталогов. Ошибка preflight останавливает следующие изменения и остаётся
в JSON/Markdown/notification-артефактах, когда исходный отчёт уже доступен.

Источник контрактов: [GitLab token scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/),
[YouTrack My User Profile](https://www.jetbrains.com/help/youtrack/devportal/resource-api-users-me.html),
[YouTrack project fields](https://www.jetbrains.com/help/youtrack/devportal/resource-api-admin-projects-projectID-customFields.html).

### No-verify, dry и silence для команд автоматизации

Все семь команд `nextjs licenses`, `sbom catalog resolve/populate` и
`security scan/track/reconcile/repair` поддерживают `-n, --no-verify`, `-d, --dry` и
`-s, --silence`, включая сочетания `-ns` и `-ds`.

```sh
spectrum nextjs licenses --dry
spectrum sbom catalog populate --dry --silence
spectrum security repair -ds
spectrum security repair --no-verify --silence
```

`--dry` выполняет предпроверки настроек, файлов, инструментов и доступов,
после чего останавливается перед действиями команды. Он не копирует LICENSE,
не выполняет npm audit/Trivy/Syft scan или исправления, не создаёт задачи,
MR и downstream pipeline, не публикует каталоги и не перезаписывает отчёты.
Для проверки используются GET-запросы, чтение image descriptor и metadata
Git/проектов; SBOM preflight может загрузить закреплённые инструменты во
временную папку и выполнить registry login с временным auth-файлом.
Временные файлы удаляются; исходники, lockfiles и существующие артефакты
сохраняются. При неполных входных отчётах dry завершается с ошибкой.

`--silence` скрывает только сообщения об успешно пройденных предпроверках.
Ошибки, предупреждения, результаты команды и итог dry остаются видимыми.
Это тот же смысл флага, что у release/hotfix команд. Без dry выполняются
обычные действия и сохраняются прежние коды завершения 0/1/2.

`--no-verify` пропускает предварительные проверки доступов GitLab/YouTrack,
registry и соответствия tracker ref. Команда сразу переходит к своим действиям:
аудиту, копированию LICENSE, работе с каталогами, задачами или исправлениям.
Загрузка входных отчётов, аутентификация для операций, проверка целостности
артефактов и проверочные команды после исправления остаются частью действия.
Пропущенные preflight не получают статус «проверено» в отчёте.
