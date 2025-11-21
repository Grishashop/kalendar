# Деплой на Cloudflare Pages

## Быстрый старт через GitHub

1. **Подготовка репозитория:**
   - Убедитесь, что ваш код находится в GitHub репозитории
   - Добавьте файл `.env.production` с переменными окружения (или используйте секреты в Cloudflare)

2. **Подключение к Cloudflare Pages:**
   - Зайдите на https://dash.cloudflare.com/
   - Перейдите в раздел "Pages"
   - Нажмите "Create a project"
   - Выберите "Connect to Git"
   - Выберите ваш GitHub репозиторий

3. **Настройка сборки:**
   - **Framework preset:** Next.js (или None)
   - **Build command:** `npm run pages:build`
   - **Build output directory:** `.vercel/output/static`
   - **Root directory:** `/` (или оставьте пустым)

4. **Переменные окружения:**
   Добавьте в настройках проекта:
   - `NEXT_PUBLIC_SUPABASE_URL` - ваш Supabase URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` - ваш Supabase Anon Key

5. **Деплой:**
   - Нажмите "Save and Deploy"
   - Cloudflare автоматически соберет и задеплоит ваш проект

## Деплой через Wrangler CLI

1. **Установите Wrangler:**
   ```bash
   npm install -g wrangler
   ```

2. **Авторизуйтесь:**
   ```bash
   wrangler login
   ```

3. **Соберите проект:**
   ```bash
   npm run pages:build
   ```

4. **Задеплойте:**
   ```bash
   wrangler pages deploy .vercel/output/static
   ```

## Локальная разработка

Для тестирования локально:
```bash
npm run preview
```

## Важные замечания

- Cloudflare Pages поддерживает Next.js через адаптер `@cloudflare/next-on-pages`
- Некоторые функции Next.js могут работать по-другому на Cloudflare (например, некоторые API routes)
- Убедитесь, что все переменные окружения настроены правильно
- Проверьте, что Supabase доступен из России (обычно доступен)

