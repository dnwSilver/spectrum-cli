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

# 📦 Управление версиями
spectrum version up major    # Поднять major версию (1.0.0 → 2.0.0)
spectrum version up minor    # Поднять minor версию (1.0.0 → 1.1.0)
spectrum version up patch    # Поднять patch версию (1.0.0 → 1.0.1)

# 🚀 Управление релизами
spectrum release start       # Полный цикл релиза
spectrum release close       # Закрыть релиз и смержить в dev
spectrum release deploy      # Деплой релиза (создать тег)

# 📝 Управление changelog
spectrum changelog append "Сообщение"  # Добавить запись в CHANGELOG.md
```

### Справка по командам:

```bash
# Справка по релизам
spectrum release --help

# Справка по версиям
spectrum version up --help

# Справка по changelog
spectrum changelog --help
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

| Команда                       | Описание                     |
| ----------------------------- | ---------------------------- |
| `spectrum release start`      | Запустить полный цикл релиза |
| `spectrum release deploy`     | Деплой релиза                |
| `spectrum release close`      | Закрыть релиз                |
| `spectrum version up major`   | Увеличить major версию       |
| `spectrum version up minor`   | Увеличить minor версию       |
| `spectrum version up patch`   | Увеличить patch версию       |
| `spectrum changelog append`   | Добавить запись в changelog  |

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

## 📝 Работа с Changelog

### `spectrum changelog append "Сообщение"`

Умная команда для добавления записей в CHANGELOG.md с автоматическим определением контекста:

**✨ Основные возможности:**
- 🔍 **Автоматическое извлечение** номера задачи из названия ветки
- 🤔 **Интерактивный запрос** номера задачи если не найден
- 👤 **Проверка Git config** с подсказками по настройке
- 🎯 **Умное определение раздела** по типу ветки
- 🎨 **Контекстный вывод** с цветовым выделением
- 🧹 **Автоматическая очистка** дефолтного текста
- ✅ **Проверка Prettier** перед изменениями `CHANGELOG.md` (команда остановится при ошибке)

**📋 Поддерживаемые типы веток:**
- `feature/` → выбор между Added, Changed, Deprecated, Removed
- `bugfix/`, `fix/` → автоматически Fixed
- `support/` → выбор между Support, Security
- другие → показ всех разделов

**📌 Пример использования:**
```bash
# На ветке feature/ABC-123-new-component
spectrum changelog append "Добавлен новый компонент кнопки"

# Результат в CHANGELOG.md:
# - ABC-123 Добавлен новый компонент кнопки. [Ваше Имя](ваш@email.com)
```

### 🔍 Линтинг CHANGELOG с Prettier

- Перед любыми изменениями changelog выполняется проверка наличия `prettier` и команда `prettier --check CHANGELOG.md`.
- Если `prettier` недоступен или проверка не пройдена, выполнение прекращается с ошибкой.
- Запуск через `npx` поддерживается автоматически: используется `npx --yes prettier` при наличии.

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
