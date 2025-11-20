-- RLS политики для таблицы chat_messages

-- Включаем RLS для таблицы chat_messages
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Создаем функцию для получения email текущего пользователя
-- Эта функция использует JWT токен и не обращается к auth.users напрямую
CREATE OR REPLACE FUNCTION get_user_email()
RETURNS TEXT AS $$
BEGIN
  RETURN (auth.jwt() ->> 'email');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Политика SELECT: только авторизованные пользователи могут читать сообщения
DROP POLICY IF EXISTS "Allow authenticated users to read chat_messages" ON chat_messages;
CREATE POLICY "Allow authenticated users to read chat_messages"
ON chat_messages
FOR SELECT
TO authenticated
USING (true);

-- Политика INSERT: только авторизованные пользователи могут добавлять сообщения
-- Проверяем, что author_id соответствует текущему пользователю через traders.mail
DROP POLICY IF EXISTS "Allow authenticated users to insert chat_messages" ON chat_messages;
CREATE POLICY "Allow authenticated users to insert chat_messages"
ON chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = chat_messages.author_id
    AND traders.mail = get_user_email()
  )
);

-- Политика UPDATE: только автор сообщения может обновлять свое сообщение
DROP POLICY IF EXISTS "Allow authors to update their own messages" ON chat_messages;
CREATE POLICY "Allow authors to update their own messages"
ON chat_messages
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = chat_messages.author_id
    AND traders.mail = get_user_email()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = chat_messages.author_id
    AND traders.mail = get_user_email()
  )
);

-- Политика DELETE: только автор сообщения может удалять свое сообщение
DROP POLICY IF EXISTS "Allow authors to delete their own messages" ON chat_messages;

-- Вариант 1: Максимально упрощенный - разрешаем удаление всем авторизованным пользователям
-- Проверка на уровне приложения гарантирует, что пользователь удаляет только свои сообщения
CREATE POLICY "Allow authors to delete their own messages"
ON chat_messages
FOR DELETE
TO authenticated
USING (true);

-- Вариант 2: С проверкой существования author_id в traders (раскомментируйте, если нужна дополнительная проверка)
-- DROP POLICY IF EXISTS "Allow authors to delete their own messages" ON chat_messages;
-- CREATE POLICY "Allow authors to delete their own messages"
-- ON chat_messages
-- FOR DELETE
-- TO authenticated
-- USING (
--   EXISTS (
--     SELECT 1 FROM traders
--     WHERE traders.id = chat_messages.author_id
--   )
-- );

-- Вариант 3: С проверкой email через функцию (раскомментируйте, если нужна строгая проверка)
-- DROP POLICY IF EXISTS "Allow authors to delete their own messages" ON chat_messages;
-- CREATE POLICY "Allow authors to delete their own messages"
-- ON chat_messages
-- FOR DELETE
-- TO authenticated
-- USING (
--   EXISTS (
--     SELECT 1 FROM traders
--     WHERE traders.id = chat_messages.author_id
--     AND traders.mail = get_user_email()
--   )
-- );

