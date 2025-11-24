# Настройка Supabase Realtime для календаря и чата

Для того, чтобы изменения в календаре и чате отображались в реальном времени на всех устройствах, необходимо включить Realtime для таблиц `dezurstva` и `chat_messages` в Supabase.

## Инструкция по включению Realtime

### Шаг 1: Войдите в Supabase Dashboard
1. Откройте https://supabase.com/dashboard
2. Войдите в свой аккаунт
3. Выберите ваш проект

### Шаг 2: Включите Realtime для таблиц

**Вариант 1: Через Database → Replication**
1. В левом меню выберите **Database**
2. Перейдите в раздел **Replication**
3. Найдите следующие таблицы в списке:
   - `dezurstva` (для календаря)
   - `chat_messages` (для чата)
4. Включите переключатель **Realtime** для каждой таблицы
5. Сохраните изменения

**Вариант 2: Через SQL Editor**
1. В левом меню выберите **SQL Editor**
2. Создайте новый запрос
3. Выполните следующий SQL код:

```sql
-- Включить Realtime для таблицы dezurstva (календарь)
ALTER PUBLICATION supabase_realtime ADD TABLE dezurstva;

-- Включить Realtime для таблицы chat_messages (чат)
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
```

4. Нажмите **Run** для выполнения запроса

### Шаг 3: Проверка работы

**Для календаря:**
1. Откройте календарь на двух разных устройствах/вкладках
2. На одном устройстве добавьте новое дежурство
3. На другом устройстве дежурство должно появиться автоматически без перезагрузки страницы

**Для чата:**
1. Откройте чат на двух разных устройствах/вкладках
2. На одном устройстве отправьте новое сообщение
3. На другом устройстве сообщение должно появиться автоматически без перезагрузки страницы

### Решение проблем

**Если изменения не отображаются в реальном времени:**

1. **Проверьте, что Realtime включен:**
   - Зайдите в Database → Replication
   - Убедитесь, что для таблиц `dezurstva` и `chat_messages` включен Realtime

2. **Проверьте консоль браузера:**
   - Откройте DevTools (F12)
   - Перейдите на вкладку Console
   - Должны быть сообщения:
     - "Successfully subscribed to dezurstva changes" (для календаря)
     - "Successfully subscribed to chat_messages changes" (для чата)
   - Если видите ошибки, проверьте настройки Supabase

3. **Проверьте RLS политики:**
   - Убедитесь, что RLS политики позволяют читать данные из таблиц
   - Для `dezurstva` в файле `supabase/dezurstva.sql` должна быть политика:
     ```sql
     CREATE POLICY "Allow all users to read dezurstva"
     ON dezurstva
     FOR SELECT
     USING (true);
     ```
   - Для `chat_messages` в файле `supabase/chat_messages.sql` должна быть политика:
     ```sql
     CREATE POLICY "Allow authenticated users to read chat_messages"
     ON chat_messages
     FOR SELECT
     TO authenticated
     USING (true);
     ```
   - **ВАЖНО:** Если Realtime не работает для чата, выполните SQL из файла `supabase/fix_chat_realtime.sql` в SQL Editor Supabase

4. **Проверьте переменные окружения:**
   - Убедитесь, что `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` правильно настроены

### Дополнительная информация

- Realtime работает через WebSocket соединение
- Изменения передаются мгновенно между всеми подключенными клиентами
- Realtime работает только для таблиц, для которых он явно включен
- Для работы Realtime требуется активное интернет-соединение

### Полезные ссылки

- [Supabase Realtime Documentation](https://supabase.com/docs/guides/realtime)
- [PostgreSQL Replication](https://supabase.com/docs/guides/database/extensions/replication)

