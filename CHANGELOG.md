# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 🚀 [3.0.0] - 2026-08-31

### 💥 Breaking change

- Команда `spectrum changelog append` создает независимый fragment в `.changelog/` вместо изменения общего `CHANGELOG.md`; для проверки добавлена команда `spectrum changelog check`, а `spectrum release start` собирает и удаляет fragments автоматически.
- Источник правды о версии — git-теги `vX.Y.Z`: CLI больше не читает и не изменяет `package.json`, lock-файлы, не создает и не проверяет `release/*`-ветки; команда `spectrum version up` удалена.
- `spectrum release start` вычисляет target от максимального стабильного тега, достижимого из stable-ветки, схлопывает fragments в `CHANGELOG.md` одним коммитом в dev и атомарно пушит release commit напрямую в dev и main/master без MR.
- `spectrum release start` блокирует новый релиз, пока `CHANGELOG.md` содержит одну или несколько версий новее последнего стабильного тега, не позволяя повторному запуску понизить версию.
- `spectrum release deploy` и `spectrum release close` читают версию релиза из верхнего заголовка `## 🚀 [X.Y.Z]` файла `CHANGELOG.md`.
- Changelog task ID принимается только из веток `<type>/<YOUTRACK-ID>` или `<type>/<YOUTRACK-ID>-<slug>`.

### 🆕 Added

- Команда `spectrum chart create` требует запись о версии в `CHANGELOG.md` чарта и запрещает версию не больше последней опубликованной (обход через `--force`).
- Флаг `--wait` команды `spectrum chart create` дожидается публикации версии чарта в Helm-registry GitLab.
- Команда `spectrum chart deploy` проверяет наличие версии чарта в Helm-registry перед обновлением helmrelease-файлов (требуется `GITLAB_PRIVATE_TOKEN`).
- Флаг `--instances` команды `spectrum chart deploy` ограничивает деплой выбранными инстансами; в сообщение коммита добавлены версия чарта и список инстансов.

## 🚀 [2.1.2] - 2026-08-17

### 🛠 Changed

- Команда `spectrum token rotate` запрашивает два токена: owner PAT для работы с CI variables и `GITLAB_PRIVATE_TOKEN` для записи в переменные.

## 🚀 [2.1.1] - 2026-08-17

### 🛠 Changed

- Команда `spectrum token rotate` больше не создает PAT. Нужно передать готовый `GITLAB_PRIVATE_TOKEN`, команда только проливает его в CI/CD variables.

## 🚀 [2.1.0] - 2026-08-17

### 🆕 Added

- Добавлена команда `spectrum token rotate` для ротации `GITLAB_PRIVATE_TOKEN` и пролива в CI/CD variables групп и проектов.

## 🚀 [1.2.2] - 2026-03-10

### 🛠 Changed

- Команда `spectrum release start` теперь требует запуск из develop-ветки.
- Команда `spectrum release close` теперь требует запуск из main-ветки.

## 🚀 [1.2.1] - 2026-03-05

### 🗑 Removed

- Убрана проверка на наличие изменений в гит при выполнение команд связанных с версией.

## 🚀 [1.2.0] - 2026-03-03

### 🆕 Added

- Добавлена команда `spectrum chart create <version>` для создания `helm chart`
- Изменен формат вывода сообщений в консоли
- Добавлен вывод прямой ссылки на создание Merge Request при `spectrum release start`
- Добавлена команда `spectrum chart deploy` для обновления `spec.chart.spec.version` в `helmrelease.yaml` до последнего remote chart-тега с интерактивным подтверждением, автокоммитом и пушем

### 🛠 Changed

- Добавлены новые preflight-проверки для chart deploy: проверка `origin`, доступности remote и наличия `helmrelease.yaml`

### 🔐 Security

- Обновлены зависимости для устранения CVE в `minmatch`

### 📦 Support

- Покрытие тестами 100%

## 🚀 [1.1.1] - 2025-10-03

### 🛠 Changed

- Исправлено поведения команды `version`, добавлены флаги `-v`/`--version`
- Добавлен этап проверки `CHANGELOG.md` через Prettier перед любыми изменениями
- Команды, изменяющие changelog, останавливаются при отсутствии `prettier` или ошибке `--check`

## 🚀 [1.1.0] - 2025-09-30

### 🆕 Added

- Добавлена команда `spectrum changelog append <message>` для умного добавления записей в CHANGELOG.md
- Автоматическое извлечение номера задачи из названия ветки (формат: [a-zA-Z]+-[0-9]+)
- Интерактивный запрос номера задачи при отсутствии в названии ветки
- Проверка Git config с предупреждениями и подсказками по настройке
- Умное определение раздела changelog по типу ветки (feature/bugfix/support)
- Интерактивный выбор раздела при неопределенности или множественных вариантах
- Автоматическое форматирование сообщений (добавление точки в конце)
- Контекстный вывод результата с цветовым выделением новой записи
- Автоматическое удаление дефолтного текста "_Список..._" при добавлении первой записи
- Установлен Jest для тестирования с полным покрытием utils функций
- Добавлены интеграционные тесты для проверки основной функциональности

### 🛠 Changed

- Обновлена документация README.md с подробным описанием команды `changelog append`
- Улучшена структура экспорта функций в модуле `src/changelog.js`

### 📦 Support

- Настроен Jest для модульного и интеграционного тестирования
- Добавлены npm scripts для запуска тестов (`test`, `test:watch`, `test:coverage`)
- Конфигурация Jest для Node.js окружения с покрытием кода
- Созданы базовые тесты для проверки стабильности функций

## 🚀 [1.0.1] - 2024-09-19

### 🆕 Added

- Создана структура проекта с каталогом `src/`
- Добавлен автоматический установщик `install.sh`
- Создан файл `INSTALL.md` с подробными инструкциями по установке
- Добавлен файл `DISTRIBUTION.md` с вариантами дистрибьюции
- Настроен `.gitignore` для Node.js проекта

### 🛠 Changed

- Перенесены все модули в каталог `src/` для лучшей организации
- Обновлены пути импортов в `index.js`
- Улучшена документация в `README.md`

### 📦 Support

- Добавлена поддержка различных способов установки
- Создан универсальный установщик для Unix-систем

## 🚀 [1.0.0] - 2024-09-19

### 🆕 Added

- Переписаны все shell-скрипты на JavaScript
- Создан CLI интерфейс `spectrum` с командой `commander`
- Добавлены основные команды:
  - `spectrum release start` - полный цикл релиза
  - `spectrum release close` - закрытие релиза
  - `spectrum release deploy` - деплой релиза
  - `spectrum version up major/minor/patch` - управление версиями
- Цветной вывод с эмодзи для лучшего UX
- Автоматическое определение пакетного менеджера (npm/yarn/bun)
- Обработка ошибок и fallback'ы
- Детальная обратная связь по операциям

### 🗑 Removed

- Удалены все старые shell-скрипты
- Убраны ненужные npm scripts
- Удалены внутренние CLI команды модулей

### 📦 Support

- Поддержка Node.js >= 14
- Интеграция с Git workflow
- Работа с `package.json` и `CHANGELOG.md`
