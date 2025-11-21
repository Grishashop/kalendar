-- SQL скрипт для создания таблицы notes с RLS политиками

-- ============================================
-- 1. Создание таблицы notes
-- ============================================
CREATE TABLE IF NOT EXISTS notes (
  id BIGSERIAL PRIMARY KEY,
  trader_id BIGINT NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  folder_id BIGINT REFERENCES note_folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  is_pinned BOOLEAN DEFAULT false,
  tags TEXT[],
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT notes_title_not_empty CHECK (char_length(trim(title)) > 0)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_notes_trader_id ON notes(trader_id);
CREATE INDEX IF NOT EXISTS idx_notes_folder_id ON notes(folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(trader_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(trader_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_is_pinned ON notes(trader_id, is_pinned DESC);
CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(trader_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_notes_tags ON notes USING GIN(tags);

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
CREATE TRIGGER update_notes_updated_at
  BEFORE UPDATE ON notes
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
-- 4. Функция для извлечения title из первой строки content
-- ============================================
CREATE OR REPLACE FUNCTION extract_title_from_content(content_text TEXT)
RETURNS TEXT AS $$
BEGIN
  IF content_text IS NULL OR content_text = '' THEN
    RETURN 'Без названия';
  END IF;
  
  RETURN substring(
    regexp_replace(
      split_part(content_text, E'\n', 1),
      '^#+\s*',
      '',
      'g'
    ),
    1,
    100
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. Функция для мягкого удаления заметки
-- ============================================
CREATE OR REPLACE FUNCTION soft_delete_note(note_id BIGINT, p_trader_id BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE notes
  SET deleted_at = NOW()
  WHERE id = note_id
    AND trader_id = p_trader_id
    AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. RLS политики для notes
-- ============================================
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- SELECT: пользователи могут видеть только свои заметки (не удаленные)
DROP POLICY IF EXISTS "Allow traders to read their own notes" ON notes;
CREATE POLICY "Allow traders to read their own notes"
ON notes
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = notes.trader_id
    AND traders.mail = get_user_email()
  )
);

-- INSERT: пользователи могут создавать только свои заметки
DROP POLICY IF EXISTS "Allow traders to insert their own notes" ON notes;
CREATE POLICY "Allow traders to insert their own notes"
ON notes
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = notes.trader_id
    AND traders.mail = get_user_email()
  )
  AND (
    notes.folder_id IS NULL
    OR EXISTS (
      SELECT 1 FROM note_folders
      WHERE note_folders.id = notes.folder_id
      AND note_folders.trader_id = notes.trader_id
    )
  )
);

-- UPDATE: пользователи могут обновлять только свои заметки
DROP POLICY IF EXISTS "Allow traders to update their own notes" ON notes;
CREATE POLICY "Allow traders to update their own notes"
ON notes
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = notes.trader_id
    AND traders.mail = get_user_email()
  )
);

-- DELETE: пользователи могут удалять только свои заметки (мягкое удаление)
DROP POLICY IF EXISTS "Allow traders to delete their own notes" ON notes;
CREATE POLICY "Allow traders to delete their own notes"
ON notes
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = notes.trader_id
    AND traders.mail = get_user_email()
  )
);

