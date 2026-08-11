-- Доступ к разделам: режим на раздел + список допущенных трейдеров.
-- Решение и отвергнутые варианты — docs/adr/0011-dostup-k-razdelam-v-middleware.md
--
-- Почему отдельные таблицы, а не колонки в traders: политика UPDATE на traders
-- разрешает пользователю править свою строку (traders.mail = get_user_email()),
-- то есть трейдер выдал бы себе доступ сам. Запись здесь — только администратору.

-- ============================================
-- 1. Режим раздела
-- ============================================
-- Режим "public" разрешён только разделу, за которым нет приватного токена:
-- публичный "karman" открыл бы анониму /api/karman/contracts и /api/ticker/quotes,
-- то есть токен Alor всему интернету. Ограничение держится в CHECK, а не только
-- в интерфейсе: соседний пункт выпадающего списка — слишком дешёвая ошибка.
CREATE TABLE IF NOT EXISTS page_access (
  page TEXT PRIMARY KEY CHECK (page IN ('market', 'karman', 'ticker')),
  mode TEXT NOT NULL CHECK (mode IN ('public', 'authenticated', 'list')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT page_access_public_only_market CHECK (mode <> 'public' OR page = 'market')
);

DROP TRIGGER IF EXISTS update_page_access_updated_at ON page_access;
CREATE TRIGGER update_page_access_updated_at
  BEFORE UPDATE ON page_access
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Режимы дня выката повторяют нынешнее поведение: /market открыт анониму,
-- остальное — любому вошедшему. Выкат замка и смена прав — разные события.
INSERT INTO page_access (page, mode) VALUES
  ('market', 'public'),
  ('karman', 'authenticated'),
  ('ticker', 'authenticated')
ON CONFLICT (page) DO NOTHING;

-- ============================================
-- 2. Список доступа
-- ============================================
CREATE TABLE IF NOT EXISTS page_access_trader (
  page TEXT NOT NULL REFERENCES page_access(page) ON DELETE CASCADE,
  trader_id BIGINT NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  PRIMARY KEY (page, trader_id)
);

CREATE INDEX IF NOT EXISTS idx_page_access_trader_page ON page_access_trader(page);

-- ============================================
-- 3. RLS
-- ============================================
ALTER TABLE page_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_access_trader ENABLE ROW LEVEL SECURITY;

-- SELECT открыт всем, включая анонимных: иначе публичный "market" не сможет
-- узнать, что он публичный. Раскрывается только состав доступа, не данные.
DROP POLICY IF EXISTS "Allow all users to read page_access" ON page_access;
CREATE POLICY "Allow all users to read page_access"
ON page_access FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all users to read page_access_trader" ON page_access_trader;
CREATE POLICY "Allow all users to read page_access_trader"
ON page_access_trader FOR SELECT USING (true);

-- Запись — только администратору. Вставка и удаление разделов не нужны:
-- набор разделов задан CHECK и живёт в коде, админ меняет только режим.
DROP POLICY IF EXISTS "Allow admins to update page_access" ON page_access;
CREATE POLICY "Allow admins to update page_access"
ON page_access FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM traders AS admin_check
    WHERE admin_check.mail = get_user_email() AND admin_check.admin = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM traders AS admin_check
    WHERE admin_check.mail = get_user_email() AND admin_check.admin = true
  )
);

DROP POLICY IF EXISTS "Allow admins to insert page_access_trader" ON page_access_trader;
CREATE POLICY "Allow admins to insert page_access_trader"
ON page_access_trader FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM traders AS admin_check
    WHERE admin_check.mail = get_user_email() AND admin_check.admin = true
  )
);

DROP POLICY IF EXISTS "Allow admins to delete page_access_trader" ON page_access_trader;
CREATE POLICY "Allow admins to delete page_access_trader"
ON page_access_trader FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM traders AS admin_check
    WHERE admin_check.mail = get_user_email() AND admin_check.admin = true
  )
);
