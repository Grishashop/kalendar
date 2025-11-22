# Инструкция по деплою на Cloudflare Pages

## Вариант 1: Через GitHub (Рекомендуется)

### Шаг 1: Подготовка репозитория
1. Убедитесь, что ваш код загружен в GitHub репозиторий
2. Убедитесь, что все изменения закоммичены и запушены

### Шаг 2: Установка зависимостей и локальная проверка
Выполните локально для проверки:
```bash
npm install
npm run pages:build
```

**Проверка сборки:**
- Убедитесь, что сборка проходит без ошибок
- Проверьте, что папка `.vercel/output/static` создана
- Для локального тестирования можно использовать: `npm run preview`

### Шаг 3: Настройка Cloudflare Pages

1. **Зайдите на Cloudflare Dashboard:**
   - Откройте https://dash.cloudflare.com/
   - Войдите в аккаунт (можно создать бесплатный)

2. **Создайте новый проект:**
   - Перейдите в раздел **"Workers & Pages"** → **"Pages"**
   - Нажмите **"Create a project"**
   - Выберите **"Connect to Git"**

3. **Подключите GitHub:**
   - Авторизуйтесь через GitHub
   - Выберите ваш репозиторий
   - Выберите ветку (обычно `main` или `master`)

4. **Настройте сборку:**
   - **Framework preset:** `Next.js` или `None`
   - **Build command:** `npm run pages:build`
   - **Build output directory:** `.vercel/output/static`
   - **Root directory:** `/` (оставьте пустым)
   - **Node version:** `20` (или последняя LTS версия)

5. **Добавьте переменные окружения:**
   В разделе **"Environment variables"** добавьте:
   - `NEXT_PUBLIC_SUPABASE_URL` = ваш Supabase URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = ваш Supabase Publishable Key (или Anon Key)
   
   **Важно:** 
   - Добавьте их для всех окружений (Production, Preview, Branch deploys)
   - Получить значения можно в настройках Supabase проекта: https://supabase.com/dashboard/project/_/settings/api

6. **Сохраните и задеплойте:**
   - Нажмите **"Save and Deploy"**
   - Дождитесь завершения сборки (обычно 2-5 минут)

### Шаг 4: Настройка домена (опционально)
- После успешного деплоя вы получите URL вида: `your-project.pages.dev`
- В настройках проекта можно добавить свой домен

## Вариант 2: Через Wrangler CLI

### Шаг 1: Установка Wrangler
```bash
npm install -g wrangler
```

### Шаг 2: Авторизация
```bash
wrangler login
```
Откроется браузер для авторизации в Cloudflare.

### Шаг 3: Сборка проекта
```bash
npm install
npm run pages:build
```

### Шаг 4: Деплой
```bash
wrangler pages deploy .vercel/output/static --project-name=kalendar
```

## Проверка работы

После деплоя проверьте:
1. Откройте URL вашего проекта
2. Проверьте, что страница загружается
3. Проверьте авторизацию
4. Проверьте работу всех функций

## Решение проблем

### Ошибка при сборке
- Убедитесь, что все зависимости установлены
- Проверьте, что переменные окружения настроены
- Проверьте логи сборки в Cloudflare Dashboard

### Ошибки при работе приложения
- Проверьте, что переменные окружения `NEXT_PUBLIC_*` правильно настроены
- Убедитесь, что Supabase доступен из России
- Проверьте консоль браузера на наличие ошибок

### Проблемы с SSR
- Cloudflare Pages поддерживает Next.js, но некоторые функции могут работать по-другому
- Если есть проблемы с SSR, можно использовать статическую генерацию

## Полезные ссылки

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Next.js on Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/nextjs/)
- [@cloudflare/next-on-pages](https://github.com/cloudflare/next-on-pages)

