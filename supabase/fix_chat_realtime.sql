-- Исправление RLS политики для chat_messages для работы с Realtime
-- Проблема: CHANNEL_ERROR при подписке на Realtime может быть связан с RLS политиками

-- Вариант 1: Убедитесь, что политика правильная (должна быть уже создана)
-- Проверьте текущую политику:
-- SELECT * FROM pg_policies WHERE tablename = 'chat_messages';

-- Если политика существует и использует TO authenticated, это должно работать
-- Но если есть проблемы, попробуйте пересоздать политику:

-- Удаляем старую политику
DROP POLICY IF EXISTS "Allow authenticated users to read chat_messages" ON chat_messages;

-- Создаем политику заново (убедитесь, что она идентична оригинальной)
CREATE POLICY "Allow authenticated users to read chat_messages"
ON chat_messages
FOR SELECT
TO authenticated
USING (true);

-- Важно: Убедитесь, что Realtime включен для таблицы chat_messages:
-- ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

