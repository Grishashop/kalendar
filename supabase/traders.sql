-- SQL скрипт для создания таблицы traders с RLS политиками

-- ============================================
-- 1. Создание таблицы traders
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

-- Индексы
CREATE INDEX IF NOT EXISTS idx_traders_mail ON traders(mail);
CREATE INDEX IF NOT EXISTS idx_traders_mozno_dezurit ON traders(mozno_dezurit);

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
CREATE TRIGGER update_traders_updated_at
  BEFORE UPDATE ON traders
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
-- 4. RLS политики для traders
-- ============================================
ALTER TABLE traders ENABLE ROW LEVEL SECURITY;

-- SELECT: все пользователи (включая анонимных) могут просматривать данные
DROP POLICY IF EXISTS "Allow all users to read traders" ON traders;
CREATE POLICY "Allow all users to read traders"
ON traders
FOR SELECT
USING (true);

-- INSERT: только авторизованные пользователи могут добавлять данные
DROP POLICY IF EXISTS "Allow authenticated users to insert traders" ON traders;
CREATE POLICY "Allow authenticated users to insert traders"
ON traders
FOR INSERT
TO authenticated
WITH CHECK (true);

-- UPDATE: пользователи могут обновлять только свою запись, админы могут обновлять любую
DROP POLICY IF EXISTS "Allow authenticated users to update traders" ON traders;
CREATE POLICY "Allow authenticated users to update traders"
ON traders
FOR UPDATE
TO authenticated
USING (
  traders.mail = get_user_email()
  OR
  EXISTS (
    SELECT 1 FROM traders AS admin_check
    WHERE admin_check.mail = get_user_email()
    AND admin_check.admin = true
  )
)
WITH CHECK (
  traders.mail = get_user_email()
  OR
  EXISTS (
    SELECT 1 FROM traders AS admin_check
    WHERE admin_check.mail = get_user_email()
    AND admin_check.admin = true
  )
);

-- DELETE: только админы могут удалять данные
DROP POLICY IF EXISTS "Allow admins to delete traders" ON traders;
CREATE POLICY "Allow admins to delete traders"
ON traders
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM traders AS admin_check
    WHERE admin_check.mail = get_user_email()
    AND admin_check.admin = true
  )
);

