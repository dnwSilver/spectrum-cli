# 🚀 Инструкции по релизам Spectrum CLI

## 📋 Подготовка к релизу

### Предварительные требования

1. **NPM аккаунт** с правами на публикацию пакета
2. **GitHub токены** настроены в репозитории:
   - `NPM_TOKEN` - токен для публикации в npm
   - `GITHUB_TOKEN` (автоматический)

### Настройка токенов

#### NPM Token
```bash
# Создать токен на npmjs.com
# Settings → Access Tokens → Generate New Token → Automation

# Добавить в GitHub Secrets:
# Repository Settings → Secrets → Actions → NPM_TOKEN
```

#### GitHub Token
Автоматически доступен как `GITHUB_TOKEN` в Actions.

## 🔄 Процесс релиза

### 1. Подготовка версии

```bash
# Убедитесь что вы на актуальной ветке
git checkout main
git pull origin main

# Увеличьте версию (используя сам Spectrum CLI!)
spectrum version up patch   # для patch: 1.0.0 → 1.0.1
spectrum version up minor   # для minor: 1.0.0 → 1.1.0
spectrum version up major   # для major: 1.0.0 → 2.0.0
```

### 2. Обновление CHANGELOG.md

Вручную обновите `CHANGELOG.md`:

```markdown
## [Unreleased]

### 🆕 Added
_Новая функциональность для следующего релиза_

## 🚀 [1.0.3] - 2024-09-19

### 🆕 Added
- Добавлена новая команда XYZ
- Улучшена производительность

### 🛠 Changed  
- Изменен формат вывода команды ABC

### 🪲 Fixed
- Исправлена ошибка с обработкой файлов
```

### 3. Коммит изменений

```bash
# Добавить изменения
git add package.json CHANGELOG.md

# Коммит с сообщением
git commit -m "🔖 Release v1.0.3

- Updated version to 1.0.3
- Updated CHANGELOG.md"

# Отправить в репозиторий
git push origin main
```

### 4. Создание тега и релиза

```bash
# Создать тег
git tag v1.0.3

# Отправить тег (запустит автоматический релиз)
git push origin v1.0.3
```

### 5. Автоматический процесс

После `git push origin v1.0.3` автоматически запускается:

1. **GitHub Actions** выполняет:
   - ✅ Тестирование кода
   - 📦 Создание архива релиза  
   - 📝 Генерация changelog из CHANGELOG.md
   - 🚀 Создание GitHub Release
   - 📤 Публикация в NPM Registry

2. **Результат:**
   - GitHub Release с архивом
   - NPM пакет доступен: `npm install -g spectrum-cli`
   - Обновление доступно: `npm update -g spectrum-cli`

## 🧪 Тестирование релиза

### NPM релиз
```bash
# Проверить что пакет доступен
npm view spectrum-cli

# Установить и протестировать
npm install -g spectrum-cli@latest
spectrum --help
spectrum --version
```

### GitHub релиз
```bash
# Проверить релиз на GitHub
curl -s https://api.github.com/repos/dnwsilver/spectrum-cli/releases/latest

# Скачать и протестировать архив
curl -L https://github.com/dnwsilver/spectrum-cli/archive/v1.0.3.tar.gz | tar -xz
cd spectrum-cli-1.0.3
npm install
./index.js --help
```

## 🔧 Откат релиза

### Если что-то пошло не так:

#### NPM
```bash
# Снять версию с NPM (в течение 72 часов)
npm unpublish spectrum-cli@1.0.3
```

#### GitHub
```bash
# Удалить тег локально и удаленно
git tag -d v1.0.3
git push --delete origin v1.0.3

# Удалить релиз через GitHub UI или API
gh release delete v1.0.3
```

## 📊 Мониторинг релизов

### NPM статистика
- [npm statistics](https://npmjs.com/package/spectrum-cli)
- [npm trends](https://npmtrends.com/spectrum-cli)

### GitHub статистика
- GitHub Insights → Traffic
- GitHub Insights → Community

## 🚨 Частые проблемы

### `npm publish` ошибка
- Проверить права доступа к пакету
- Убедиться что версия уникальна
- Проверить `NPM_TOKEN` в GitHub Secrets

### GitHub Actions не запускаются  
- Проверить что тег начинается с `v`
- Убедиться что Actions включены в репозитории

## 🎯 Best Practices

1. **Всегда тестировать** перед релизом
2. **Следовать SemVer** при выборе версии  
3. **Обновлять CHANGELOG.md** перед каждым релизом
4. **Тестировать релиз** после публикации
5. **Мониторить** download статистику
6. **Быстро реагировать** на issues после релиза

---

*Следуйте этим инструкциям для стабильных и предсказуемых релизов* ✨
