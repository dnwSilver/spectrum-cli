# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🆕 Added

_Список новой функциональности._

### 🛠 Changed

_Список изменившейся функциональности._

### 📜 Deprecated

_Список устаревшей функциональности._

### 🗑 Removed

_Список удаленной функциональности._

### 🪲 Fixed

_Список исправлений багов._

### 🔐 Security

_Список правок для обеспечения безопасности._

### 📦 Support

_Список правок для обеспечения технической поддержки._

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
  - `spectrum up version major/minor/patch` - управление версиями
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
