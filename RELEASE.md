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
./index.js up version patch   # для patch: 1.0.0 → 1.0.1  
./index.js up version minor   # для minor: 1.0.0 → 1.1.0
./index.js up version major   # для major: 1.0.0 → 2.0.0
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

## 🍺 Обновление Homebrew Formula

После успешного NPM релиза нужно обновить Homebrew formula **вручную**:

### 1. Создание Homebrew Tap (единоразово)

```bash
# Создать репозиторий homebrew-spectrum-cli
gh repo create homebrew-spectrum-cli --public
git clone https://github.com/dnwsilver/homebrew-spectrum-cli.git
cd homebrew-spectrum-cli

# Создать формулу  
mkdir Formula
cp ../spectrum-cli/spectrum-cli.rb Formula/spectrum-cli.rb
git add .
git commit -m "Initial spectrum-cli formula"
git push origin main
```

### 2. Обновление формулы при релизе

```bash
cd homebrew-spectrum-cli

# Получить SHA256 нового релиза
curl -s https://registry.npmjs.org/spectrum-cli/1.0.3 | jq -r '.dist.shasum'

# Обновить Formula/spectrum-cli.rb
sed -i 's/spectrum-cli-[0-9.]*.tgz/spectrum-cli-1.0.3.tgz/' Formula/spectrum-cli.rb
sed -i 's/sha256 ".*"/sha256 "NEW_SHA256"/' Formula/spectrum-cli.rb

# Коммит и пуш
git add Formula/spectrum-cli.rb
git commit -m "Update spectrum-cli to v1.0.3"
git push origin main
```

### 3. Установка через Homebrew

```bash
# Пользователи смогут установить:
brew tap dnwsilver/spectrum-cli
brew install spectrum-cli

# Или обновить:
brew upgrade spectrum-cli
```

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

### Homebrew статистика
```bash
# Проверить статистику формулы
brew info spectrum-cli
```

## 🚨 Частые проблемы

### `npm publish` ошибка
- Проверить права доступа к пакету
- Убедиться что версия уникальна
- Проверить `NPM_TOKEN` в GitHub Secrets

### GitHub Actions не запускаются  
- Проверить что тег начинается с `v`
- Убедиться что Actions включены в репозитории

### Homebrew установка не работает
- Проверить синтаксис `.rb` формулы
- Убедиться что URL и SHA256 корректны

## 🎯 Best Practices

1. **Всегда тестировать** перед релизом
2. **Следовать SemVer** при выборе версии  
3. **Обновлять CHANGELOG.md** перед каждым релизом
4. **Тестировать релиз** после публикации
5. **Мониторить** download статистику
6. **Быстро реагировать** на issues после релиза

---

*Следуйте этим инструкциям для стабильных и предсказуемых релизов* ✨
