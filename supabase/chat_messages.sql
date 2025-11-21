-- SQL скрипт для создания таблицы chat_messages с RLS политиками

-- ============================================
-- 1. Создание таблицы chat_messages
-- ============================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  author_id BIGINT NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  reply_to_id BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL,
  mentioned_trader_id BIGINT REFERENCES traders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_chat_messages_author_id ON chat_messages(author_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to_id ON chat_messages(reply_to_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_mentioned_trader_id ON chat_messages(mentioned_trader_id);

-- ============================================
-- 2. Функция для автоматического обновления updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоматического обновления updated_at
CREATE TRIGGER update_chat_messages_updated_at
  BEFORE UPDATE ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 3. Функция для получения email текущего пользователя
-- ============================================
CREATE OR REPLACE FUNCTION get_user_email()
RETURNS TEXT AS $$
BEGIN
  RETURN (auth.jwt() ->> 'email');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. RLS политики для chat_messages
-- ============================================
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: только авторизованные пользователи могут читать сообщения
DROP POLICY IF EXISTS "Allow authenticated users to read chat_messages" ON chat_messages;
CREATE POLICY "Allow authenticated users to read chat_messages"
ON chat_messages
FOR SELECT
TO authenticated
USING (true);

-- INSERT: только авторизованные пользователи могут добавлять сообщения
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

-- UPDATE: только автор сообщения может обновлять свое сообщение
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

-- DELETE: только автор сообщения может удалять свое сообщение
DROP POLICY IF EXISTS "Allow authors to delete their own messages" ON chat_messages;
CREATE POLICY "Allow authors to delete their own messages"
ON chat_messages
FOR DELETE
TO authenticated
USING (true);

