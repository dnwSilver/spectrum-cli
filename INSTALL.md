# 📦 Установка Spectrum CLI

> **Spectrum CLI** - современный инструмент для автоматизации workflow разработки

## 🚀 Быстрая установка

### NPM

```bash
# Установить глобально из npm registry
npm install -g spectrum-cli

# Проверить установку
spectrum --version
spectrum --help
```

# Установить зависимости

npm install --production

# Использовать

```
./index.js --help

```

## 🔧 Системные требования

- **Node.js** >= 20.0.0
- **npm** или **yarn**
- **Git** >= 2.0.0

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

# Создать и запушить chart тег
./index.js chart create 1.2.3
```

## 🔧 Настройка проекта

Для корректной работы Spectrum CLI ваш проект должен содержать:

1. **package.json** - с полем `version`
2. **CHANGELOG.md** - в формате Keep a Changelog
3. **Git репозиторий** - с настроенными remote
4. **Ветки** - `main`/`master` и `develop`/`dev`
5. **Helm chart** - файл `charts/<chart-name>/Chart.yaml` с полем `name` (для `chart create`)

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

_После установки переходите к [README.md](./README.md) для изучения команд_ 📚
