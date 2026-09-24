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

### 1. Подготовка изменений

```bash
# На рабочей ветке создайте changelog fragment
spectrum changelog append "Добавлена новая команда"

# Проверьте CHANGELOG.md и fragments
spectrum changelog check

# Закоммитьте fragment вместе с изменением
git add .changelog
git commit -m "📝 Добавить changelog fragment."
```

Файл имеет имя `.changelog/<name>.<type>.md`. Тип задает раздел и минимальное повышение SemVer:

- `breaking` → major;
- `added` → minor;
- `changed`, `deprecated`, `removed`, `fixed`, `security`, `support` → patch.

Каждая непустая строка fragment начинается с `- `. Общий `CHANGELOG.md` в feature-ветках вручную не изменяется.

### 2. Запуск release-процесса

```bash
git switch develop
git pull --ff-only
spectrum release start
```

Команда автоматически:

1. Проверяет чистое рабочее дерево, актуальность ветки, `CHANGELOG.md` и все fragments. Если в main/master уже есть открытый релиз, дополняет его без повышения версии и изменения даты; прежние записи сохраняются, дубли не добавляются.
2. После `git fetch origin --prune --tags` выбирает максимальный stable среди `release/X.Y.Z`, `hotfix/X.Y.Z` и старых `vX.Y.Z`, достижимый из `origin/main` или `origin/master`, и при создании нового раздела применяет к нему максимальное требуемое повышение SemVer. Для открытого раздела сохраняет уже выбранную версию независимо от типов новых fragments.
3. Создаёт или дополняет релизный блок `## 🚀 [X.Y.Z]` в `CHANGELOG.md` из fragments, форматирует и проверяет результат.
4. Удаляет использованные fragments.
5. Коммитит схлопнутый changelog в `dev`. Повторный запуск без новых fragments не создаёт пустой коммит и позволяет повторить неудавшийся push.
6. Атомарно пушит release commit напрямую в `origin/dev` и `origin/main` или `origin/master`, без Merge Request.

`package.json`, lock-файлы и `release/*`-ветки команда не трогает: версия живет
только в git-тегах и заголовке `CHANGELOG.md`. Прямой push в stable-ветку должен
быть разрешен правилами защиты репозитория; non-fast-forward обновление
отклоняется.

### 3. Проверка RC

Прямой push в main/master должен выпустить registry-only `X.Y.Z-rc.N`, где
`X.Y.Z` — версия из верхнего заголовка `CHANGELOG.md`; retry того же SHA
переиспользует номер. Проверьте RC до создания stable-тега.

### 4. Создание стабильного тега и релиза

```bash
git switch main
git pull --ff-only
spectrum release deploy
```

Команда читает версию `X.Y.Z` из верхнего заголовка `CHANGELOG.md` и создает
только `release/X.Y.Z`. RC Git-тегов нет. Stable pipeline должен найти максимальный RC
с OCI revision текущего commit, проверить обязательные образы и продвинуть их
точные digest в `X.Y.Z` без пересборки.

### 5. Закрытие релиза

```bash
# Только после успешного stable pipeline
spectrum release close
```

`release close` только мержит main/master в dev и пушит dev. Никакие файлы
версий не изменяются: следующая версия вычисляется из тегов и `.changelog/`.

### Отдельный цикл хотфикса приложения

Обычный `release start` отправляет весь integration snapshot в production и для
изолированного хотфикса не подходит. Используйте отдельный цикл:

1. От актуального production создайте `hotfix/<TASK>[-slug]`, внесите исправление
   и его patch fragments. Выполните `spectrum hotfix start` из корня проекта.
   Это только локальная подготовка `CHANGELOG.md` и удаление собранных fragments;
   commit, push, merge и tag отсутствуют.
2. Цель — опубликованный production stable плюс ровно один patch. Повторный
   `start` дополняет тот же верхний неопубликованный раздел без повышения версии,
   изменения даты и дублирования записей. Без новых fragments — no-op.
3. В MR `hotfix/* → main/master` уже включите подготовленный раздел и удаления
   fragments вместе с исправлением. Merge выполняется отдельно. Обновляйте базу
   при параллельных хотфиксах: до публикации они дополняют один patch, после неё
   новый хотфикс готовит следующий patch. Dev в production не переносится.
4. После merge MR и проверки RC запустите `spectrum hotfix deploy` на чистом
   production, совпадающем с origin. Отправляется только тег `hotfix/X.Y.Z` на проверенном
   commit; версия и ветки не меняются. CLI не проверяет успешность CI или выката.
5. После успешного stable pipeline запустите `spectrum hotfix close`: production
   вливается в `dev/develop`, затем отправляется только integration. Незавершённая
   работа сохраняется; конфликты и локальные неопубликованные commits требуют
   ручного согласования. Никакие fragments повторно не создаются.

Файлы версий приложения и lock-файлы во всех трёх фазах остаются без изменений.
Подробнее о проверках и восстановлении после ошибки push — в README.

### 6. Автоматический процесс

После push `release/X.Y.Z`, `hotfix/X.Y.Z` или старого `vX.Y.Z` запускается:

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
3. **Добавлять fragment** в каждую ветку с пользовательским, интеграционным или операционным изменением
4. **Тестировать релиз** после публикации
5. **Мониторить** download статистику
6. **Быстро реагировать** на issues после релиза

---

*Следуйте этим инструкциям для стабильных и предсказуемых релизов* ✨
