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
# Перейти в директорию проекта
cd /path/to/your/project

# Запустить полный цикл релиза (на dev-ветке)
./index.js release start

# Создать и запушить chart тег
./index.js chart create 1.2.3
```

## 🔧 Настройка проекта

Для корректной работы Spectrum CLI ваш проект должен содержать:

1. **CHANGELOG.md** - в формате Keep a Changelog без постоянного блока `Unreleased`
2. **Git репозиторий** - с настроенными remote и стабильными тегами `vX.Y.Z`
3. **Ветки** - `main`/`master` и `develop`/`dev`
4. **Helm chart** - файл `charts/<chart-name>/Chart.yaml` с полем `name` (для `chart create`)

Версия проекта живет только в git-тегах `vX.Y.Z` и заголовках `CHANGELOG.md`.
Поле `version` в `package.json` CLI не читает и не изменяет.

Рабочие ветки именуются `<type>/<YOUTRACK-ID>` или
`<type>/<YOUTRACK-ID>-<slug>`, например `feature/AR-123` и
`hotfix/ABBVJSOP-1-timeout`.

### Пример минимальной структуры:

```
my-project/
├── CHANGELOG.md      # История собранных релизов (верхний заголовок = версия релиза)
├── .changelog/       # <name>.<type>.md для следующего релиза
└── .git/             # git init + теги vX.Y.Z
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
