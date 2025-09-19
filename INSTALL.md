# 📦 Установка Spectrum CLI

> **Spectrum CLI** - современный инструмент для автоматизации workflow разработки

## 🚀 Быстрая установка

### Вариант 1: NPM (рекомендуется)

```bash
# Установить глобально из npm registry
npm install -g spectrum-cli

# Проверить установку
spectrum --version
spectrum --help
```

### Вариант 2: Homebrew (macOS/Linux)

```bash
# Добавить tap
brew tap dnwsilver/spectrum-cli

# Установить
brew install spectrum-cli

# Проверить установку
spectrum --version
spectrum --help
```

### Вариант 3: Из исходников

```bash
# Склонировать репозиторий
git clone https://github.com/dnwsilver/spectrum-cli.git
cd spectrum-cli

# Установить зависимости
npm install

# Проверить установку
./index.js --help
```

### Вариант 4: Автоматический установщик

```bash
# Использовать установочный скрипт
curl -fsSL https://raw.githubusercontent.com/dnwsilver/spectrum-cli/main/install.sh | bash

# Проверить установку
spectrum --help
```

### Вариант 5: Portable версия

```bash
# Скачать архив релиза
curl -L https://github.com/dnwsilver/spectrum-cli/releases/latest/download/spectrum-cli.tar.gz | tar -xz

# Перейти в директорию
cd spectrum-cli-*

# Установить зависимости
npm install --production

# Использовать
./index.js --help
```

## 🔧 Системные требования

- **Node.js** >= 14.0.0
- **npm** или **yarn**
- **Git** >= 2.0.0

### Установка зависимостей на macOS:

```bash
# Homebrew
brew install node git
```

### Установка зависимостей на Ubuntu/Debian:

```bash
# NodeJS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

### Установка зависимостей на CentOS/RHEL:

```bash
# NodeJS
curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
sudo yum install nodejs git
```

## ✅ Проверка установки

```bash
# Проверить версию Node.js
node --version

# Проверить Git
git --version

# Проверить Spectrum CLI
./index.js --version
./index.js --help
```

## 🎯 Первое использование

```bash
# Перейти в директорию проекта с package.json
cd /path/to/your/project

# Увеличить patch версию
./index.js up version patch

# Запустить полный цикл релиза
./index.js release start
```

## 🔧 Настройка проекта

Для корректной работы Spectrum CLI ваш проект должен содержать:

1. **package.json** - с полем `version`
2. **CHANGELOG.md** - в формате Keep a Changelog
3. **Git репозиторий** - с настроенными remote
4. **Ветки** - `main`/`master` и `develop`/`dev`

### Пример минимальной структуры:

```
my-project/
├── package.json      # {"version": "1.0.0", ...}
├── CHANGELOG.md      # ## [Unreleased]
└── .git/             # git init
```

## 🆘 Решение проблем

### "Command not found"
```bash
# Убедитесь что Node.js установлен
which node

# Или используйте полный путь
/path/to/spectrum-cli/index.js --help
```

### "Permission denied"
```bash
# Сделайте файл исполняемым
chmod +x index.js
```

### "Cannot find module 'commander'"
```bash
# Установите зависимости
npm install
```

### "Git branch not found"
```bash
# Создайте необходимые ветки
git checkout -b develop
git checkout -b main
```

## 📞 Поддержка

- 🐛 **Issues**: [GitHub Issues](https://github.com/dnwsilver/spectrum-cli/issues)
- 📖 **Документация**: [README.md](./README.md)
- 💬 **Обсуждения**: [GitHub Discussions](https://github.com/dnwsilver/spectrum-cli/discussions)

---

*После установки переходите к [README.md](./README.md) для изучения команд* 📚
