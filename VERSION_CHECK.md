# Проверка версии на хостинге

## Как проверить версию проекта на хостинге

### Способ 1: Через API endpoint

Откройте в браузере:
```
https://ваш-домен.com/api/version
```

Вы получите JSON с информацией:
```json
{
  "version": "1.2.0",
  "commitHash": "36784be",
  "commitDate": "2025-11-24 21:48:16 +0300",
  "commitMessage": "Улучшена подписка на Realtime для чата",
  "buildTime": "2025-11-24T21:48:16.000Z",
  "environment": "production",
  "vercelUrl": "your-app.vercel.app"
}
```

### Способ 2: Через UI на странице

На каждой странице в правом нижнем углу отображается версия:
- Версия из package.json (например, v1.2.0)
- Короткий commit hash (например, 36784be)
- Дата коммита

### Способ 3: Через консоль браузера

Откройте консоль браузера (F12) и найдите сообщения:
```
Версия приложения
Версия: 1.2.0
Commit: 36784be
Дата коммита: 2025-11-24 21:48:16 +0300
Сообщение: Улучшена подписка на Realtime для чата
Время сборки: 2025-11-24T21:48:16.000Z
Окружение: production
```

### Способ 4: Сравнение с GitHub

1. Получите commit hash с хостинга (через API или UI)
2. Откройте GitHub репозиторий: https://github.com/Grishashop/kalendar
3. Проверьте, что commit hash совпадает с последним коммитом в ветке `main`

### Для Vercel

Vercel автоматически устанавливает переменные окружения:
- `VERCEL_GIT_COMMIT_SHA` - полный commit hash
- `VERCEL_GIT_COMMIT_MESSAGE` - сообщение коммита

Эти данные автоматически отображаются в API endpoint.

### Обновление версии

При обновлении версии проекта:
1. Обновите `version` в `package.json`
2. Сделайте коммит и push в GitHub
3. Дождитесь автоматического деплоя на хостинге
4. Проверьте версию через `/api/version` или UI

### Пример скрипта для проверки

```bash
# Проверка версии на хостинге
curl https://ваш-домен.com/api/version | jq

# Сравнение с локальным коммитом
LOCAL_COMMIT=$(git rev-parse --short HEAD)
REMOTE_COMMIT=$(curl -s https://ваш-домен.com/api/version | jq -r '.commitHash')

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
  echo "✅ Версии совпадают"
else
  echo "❌ Версии не совпадают: локальная=$LOCAL_COMMIT, удаленная=$REMOTE_COMMIT"
fi
```

