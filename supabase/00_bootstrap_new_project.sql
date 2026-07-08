-- ============================================================
-- Единый скрипт для развёртывания схемы на НОВОМ Supabase-проекте
-- (используется при миграции из-за исчерпания egress-лимита на старом)
--
-- Порядок важен из-за внешних ключей:
--   traders -> typ_dezurstva -> dezurstva -> note_folders -> notes -> chat_messages
--
-- Как использовать:
--   1. Откройте новый проект в Supabase Dashboard -> SQL Editor
--   2. Вставьте содержимое этого файла целиком и выполните (Run)
--   3. Импортируйте данные (CSV) в таблицы через Table Editor, в том же порядке
--   4. После импорта выполните блок "СБРОС SEQUENCE" внизу файла
-- ============================================================

-- ============================================
-- Общие функции (используются всеми таблицами)
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_user_email()
RETURNS TEXT AS $$
BEGIN
  RETURN (auth.jwt() ->> 'email');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 1. traders
-- ============================================
CREATE TABLE IF NOT EXISTS traders (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  name_short TEXT,
  photo TEXT,
  mail TEXT UNIQUE NOT NULL,
  phone TEXT,
  mozno_dezurit BOOLEAN DEFAULT false,
  admin BOOLEAN DEFAULT false,
  chat BOOLEAN DEFAULT false,
  zametki BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traders_mail ON traders(mail);
CREATE INDEX IF NOT EXISTS idx_traders_mozno_dezurit ON traders(mozno_dezurit);

CREATE TRIGGER update_traders_updated_at
  BEFORE UPDATE ON traders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE traders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all users to read traders"
ON traders FOR SELECT USING (true);

CREATE POLICY "Allow authenticated users to insert traders"
ON traders FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update traders"
ON traders FOR UPDATE TO authenticated
USING (
  traders.mail = get_user_email()
  OR EXISTS (SELECT 1 FROM traders AS admin_check WHERE admin_check.mail = get_user_email() AND admin_check.admin = true)
)
WITH CHECK (
  traders.mail = get_user_email()
  OR EXISTS (SELECT 1 FROM traders AS admin_check WHERE admin_check.mail = get_user_email() AND admin_check.admin = true)
);

CREATE POLICY "Allow admins to delete traders"
ON traders FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM traders AS admin_check WHERE admin_check.mail = get_user_email() AND admin_check.admin = true)
);

-- ============================================
-- 2. typ_dezurstva
-- ============================================
CREATE TABLE IF NOT EXISTS typ_dezurstva (
  tip_dezursva_or_otdyh TEXT PRIMARY KEY,
  color TEXT,
  ves INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_typ_dezurstva_ves ON typ_dezurstva(ves);

CREATE TRIGGER update_typ_dezurstva_updated_at
  BEFORE UPDATE ON typ_dezurstva
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE typ_dezurstva ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all users to read typ_dezurstva"
ON typ_dezurstva FOR SELECT USING (true);

CREATE POLICY "Allow authenticated users to insert typ_dezurstva"
ON typ_dezurstva FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update typ_dezurstva"
ON typ_dezurstva FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete typ_dezurstva"
ON typ_dezurstva FOR DELETE TO authenticated USING (true);

-- ============================================
-- 3. dezurstva
-- ============================================
CREATE TABLE IF NOT EXISTS dezurstva (
  id BIGSERIAL PRIMARY KEY,
  date_dezurztva_or_otdyh DATE NOT NULL,
  traders TEXT,
  tip_dezursva_or_otdyh TEXT REFERENCES typ_dezurstva(tip_dezursva_or_otdyh),
  utverzdeno BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dezurstva_date ON dezurstva(date_dezurztva_or_otdyh);
CREATE INDEX IF NOT EXISTS idx_dezurstva_traders ON dezurstva(traders);
CREATE INDEX IF NOT EXISTS idx_dezurstva_utverzdeno ON dezurstva(utverzdeno);

CREATE TRIGGER update_dezurstva_updated_at
  BEFORE UPDATE ON dezurstva
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE dezurstva ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all users to read dezurstva"
ON dezurstva FOR SELECT USING (true);

CREATE POLICY "Allow authenticated users to insert dezurstva"
ON dezurstva FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update dezurstva"
ON dezurstva FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete dezurstva"
ON dezurstva FOR DELETE TO authenticated USING (true);

-- ============================================
-- 4. note_folders
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

CREATE INDEX IF NOT EXISTS idx_note_folders_trader_id ON note_folders(trader_id);
CREATE INDEX IF NOT EXISTS idx_note_folders_sort_order ON note_folders(trader_id, sort_order);

CREATE TRIGGER update_note_folders_updated_at
  BEFORE UPDATE ON note_folders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE note_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow traders to read their own folders"
ON note_folders FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM traders WHERE traders.id = note_folders.trader_id AND traders.mail = get_user_email()));

CREATE POLICY "Allow traders to insert their own folders"
ON note_folders FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM traders WHERE traders.id = note_folders.trader_id AND traders.mail = get_user_email()));

CREATE POLICY "Allow traders to update their own folders"
ON note_folders FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM traders WHERE traders.id = note_folders.trader_id AND traders.mail = get_user_email()))
WITH CHECK (EXISTS (SELECT 1 FROM traders WHERE traders.id = note_folders.trader_id AND traders.mail = get_user_email()));

CREATE POLICY "Allow traders to delete their own folders"
ON note_folders FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM traders WHERE traders.id = note_folders.trader_id AND traders.mail = get_user_email()));

-- ============================================
-- 5. notes
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

CREATE INDEX IF NOT EXISTS idx_notes_trader_id ON notes(trader_id);
CREATE INDEX IF NOT EXISTS idx_notes_folder_id ON notes(folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(trader_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(trader_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_is_pinned ON notes(trader_id, is_pinned DESC);
CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(trader_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_notes_tags ON notes USING GIN(tags);

CREATE TRIGGER update_notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION extract_title_from_content(content_text TEXT)
RETURNS TEXT AS $$
BEGIN
  IF content_text IS NULL OR content_text = '' THEN
    RETURN 'Без названия';
  END IF;
  RETURN substring(
    regexp_replace(split_part(content_text, E'\n', 1), '^#+\s*', '', 'g'),
    1, 100
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION soft_delete_note(note_id BIGINT, p_trader_id BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE notes
  SET deleted_at = NOW()
  WHERE id = note_id AND trader_id = p_trader_id AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow traders to read their own notes"
ON notes FOR SELECT TO authenticated
USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM traders WHERE traders.id = notes.trader_id AND traders.mail = get_user_email()));

CREATE POLICY "Allow traders to insert their own notes"
ON notes FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM traders WHERE traders.id = notes.trader_id AND traders.mail = get_user_email())
  AND (
    notes.folder_id IS NULL
    OR EXISTS (SELECT 1 FROM note_folders WHERE note_folders.id = notes.folder_id AND note_folders.trader_id = notes.trader_id)
  )
);

CREATE POLICY "Allow traders to update their own notes"
ON notes FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM traders WHERE traders.id = notes.trader_id AND traders.mail = get_user_email()));

CREATE POLICY "Allow traders to delete their own notes"
ON notes FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM traders WHERE traders.id = notes.trader_id AND traders.mail = get_user_email()));

-- ============================================
-- 6. chat_messages
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

CREATE INDEX IF NOT EXISTS idx_chat_messages_author_id ON chat_messages(author_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to_id ON chat_messages(reply_to_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_mentioned_trader_id ON chat_messages(mentioned_trader_id);

CREATE TRIGGER update_chat_messages_updated_at
  BEFORE UPDATE ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read chat_messages"
ON chat_messages FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert chat_messages"
ON chat_messages FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM traders WHERE traders.id = chat_messages.author_id AND traders.mail = get_user_email()));

CREATE POLICY "Allow authors to update their own messages"
ON chat_messages FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM traders WHERE traders.id = chat_messages.author_id AND traders.mail = get_user_email()))
WITH CHECK (EXISTS (SELECT 1 FROM traders WHERE traders.id = chat_messages.author_id AND traders.mail = get_user_email()));

CREATE POLICY "Allow authors to delete their own messages"
ON chat_messages FOR DELETE TO authenticated USING (true);

-- ============================================
-- 7. Включаем Realtime для таблиц, которые его используют
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE dezurstva;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- ============================================================
-- СБРОС SEQUENCE — выполнить ПОСЛЕ импорта CSV-данных,
-- иначе следующая вставка через приложение упадёт с ошибкой
-- duplicate key (id), т.к. счётчик BIGSERIAL не знает про
-- импортированные id.
-- ============================================================
-- SELECT setval(pg_get_serial_sequence('traders', 'id'), COALESCE((SELECT MAX(id) FROM traders), 1));
-- SELECT setval(pg_get_serial_sequence('dezurstva', 'id'), COALESCE((SELECT MAX(id) FROM dezurstva), 1));
-- SELECT setval(pg_get_serial_sequence('note_folders', 'id'), COALESCE((SELECT MAX(id) FROM note_folders), 1));
-- SELECT setval(pg_get_serial_sequence('notes', 'id'), COALESCE((SELECT MAX(id) FROM notes), 1));
-- SELECT setval(pg_get_serial_sequence('chat_messages', 'id'), COALESCE((SELECT MAX(id) FROM chat_messages), 1));
