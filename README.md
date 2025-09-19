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

### 🍺 Homebrew (macOS/Linux)

```bash
# Добавить tap и установить
brew tap dnwsilver/spectrum-cli
brew install spectrum-cli

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

# 📦 Управление версиями
spectrum up version major    # Поднять major версию (1.0.0 → 2.0.0)
spectrum up version minor    # Поднять minor версию (1.0.0 → 1.1.0)
spectrum up version patch    # Поднять patch версию (1.0.0 → 1.0.1)

# 🚀 Управление релизами
spectrum release start       # Полный цикл релиза
spectrum release close       # Закрыть релиз и смержить в dev
spectrum release deploy      # Деплой релиза (создать тег)
```

### Справка по командам:

```bash
# Справка по релизам
spectrum release --help

# Справка по версиям
spectrum up version --help
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
├── src/               # 📁 Исходный код
│   ├── utils.js       # 🛠️ Утилиты и логирование
│   ├── git.js         # 📝 Git операции
│   ├── version.js     # 📦 Управление версиями SemVer
│   ├── changelog.js   # 📋 Работа с CHANGELOG.md
│   ├── development.js # ⚡ Dev команды (внутренние)
│   └── release.js     # 🚀 Release процесс
├── package.json       # 📦 Конфигурация проекта
├── install.sh         # 🔧 Автоматический установщик
├── INSTALL.md         # 📋 Инструкции по установке
└── README.md          # 📖 Документация
```

### Команды:

| Команда                     | Описание                     |
| --------------------------- | ---------------------------- |
| `spectrum up version major` | Увеличить major версию       |
| `spectrum up version minor` | Увеличить minor версию       |
| `spectrum up version patch` | Увеличить patch версию       |
| `spectrum release start`    | Запустить полный цикл релиза |
| `spectrum release close`    | Закрыть релиз                |
| `spectrum release deploy`   | Деплой релиза                |

## 🔄 Workflow релиза

### `spectrum release start`

1. Переключается на dev ветку
2. Создает release/X.Y.Z ветку
3. Обновляет заголовок в CHANGELOG.md
4. Удаляет пустые секции из changelog
5. Добавляет новый блок Unreleased
6. Коммитит изменения
7. Пушит release ветку

### `spectrum release close`

1. Переключается на main ветку
2. Обновляет main ветку
3. Переключается на dev ветку
4. Мержит main в dev
5. Пушит dev ветку

### `spectrum release deploy`

1. Переключается на main ветку
2. Создает тег с текущей версией
3. Пушит тег в remote

## 🎯 Философия

- **Простота** - минимум команд, максимум функциональности
- **Безопасность** - все операции с обработкой ошибок
- **Скорость** - быстрые операции без лишних зависимостей
- **Читаемость** - понятные логи и сообщения

## 📚 Дополнительная документация

- 📋 **[Установка](./INSTALL.md)** - подробные инструкции по установке
- 🚀 **[Релизы](./RELEASE.md)** - инструкции по выпуску новых версий
- 📦 **[Дистрибьюция](./DISTRIBUTION.md)** - варианты распространения

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
