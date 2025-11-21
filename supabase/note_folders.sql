-- SQL скрипт для создания таблицы note_folders с RLS политиками

-- ============================================
-- 1. Создание таблицы note_folders
-- ============================================
CREATE TABLE IF NOT EXISTS note_folders (
  id BIGSERIAL PRIMARY KEY,
  trader_id BIGINT NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT note_folders_trader_name_unique UNIQUE (trader_id, name)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_note_folders_trader_id ON note_folders(trader_id);
CREATE INDEX IF NOT EXISTS idx_note_folders_sort_order ON note_folders(trader_id, sort_order);

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
CREATE TRIGGER update_note_folders_updated_at
  BEFORE UPDATE ON note_folders
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
-- 4. RLS политики для note_folders
-- ============================================
ALTER TABLE note_folders ENABLE ROW LEVEL SECURITY;

-- SELECT: пользователи могут видеть только свои папки
DROP POLICY IF EXISTS "Allow traders to read their own folders" ON note_folders;
CREATE POLICY "Allow traders to read their own folders"
ON note_folders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = note_folders.trader_id
    AND traders.mail = get_user_email()
  )
);

-- INSERT: пользователи могут создавать только свои папки
DROP POLICY IF EXISTS "Allow traders to insert their own folders" ON note_folders;
CREATE POLICY "Allow traders to insert their own folders"
ON note_folders
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = note_folders.trader_id
    AND traders.mail = get_user_email()
  )
);

-- UPDATE: пользователи могут обновлять только свои папки
DROP POLICY IF EXISTS "Allow traders to update their own folders" ON note_folders;
CREATE POLICY "Allow traders to update their own folders"
ON note_folders
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = note_folders.trader_id
    AND traders.mail = get_user_email()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = note_folders.trader_id
    AND traders.mail = get_user_email()
  )
);

-- DELETE: пользователи могут удалять только свои папки
DROP POLICY IF EXISTS "Allow traders to delete their own folders" ON note_folders;
CREATE POLICY "Allow traders to delete their own folders"
ON note_folders
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = note_folders.trader_id
    AND traders.mail = get_user_email()
  )
);

