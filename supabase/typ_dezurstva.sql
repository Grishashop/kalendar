-- SQL скрипт для создания таблицы typ_dezurstva с RLS политиками

-- ============================================
-- 1. Создание таблицы typ_dezurstva
-- ============================================
CREATE TABLE IF NOT EXISTS typ_dezurstva (
  tip_dezursva_or_otdyh TEXT PRIMARY KEY,
  color TEXT,
  ves INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_typ_dezurstva_ves ON typ_dezurstva(ves);

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
CREATE TRIGGER update_typ_dezurstva_updated_at
  BEFORE UPDATE ON typ_dezurstva
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
-- 4. RLS политики для typ_dezurstva
-- ============================================
ALTER TABLE typ_dezurstva ENABLE ROW LEVEL SECURITY;

-- SELECT: все пользователи (включая анонимных) могут просматривать данные
DROP POLICY IF EXISTS "Allow all users to read typ_dezurstva" ON typ_dezurstva;
CREATE POLICY "Allow all users to read typ_dezurstva"
ON typ_dezurstva
FOR SELECT
USING (true);

-- INSERT: только авторизованные пользователи могут добавлять данные
DROP POLICY IF EXISTS "Allow authenticated users to insert typ_dezurstva" ON typ_dezurstva;
CREATE POLICY "Allow authenticated users to insert typ_dezurstva"
ON typ_dezurstva
FOR INSERT
TO authenticated
WITH CHECK (true);

-- UPDATE: только авторизованные пользователи могут обновлять данные
DROP POLICY IF EXISTS "Allow authenticated users to update typ_dezurstva" ON typ_dezurstva;
CREATE POLICY "Allow authenticated users to update typ_dezurstva"
ON typ_dezurstva
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- DELETE: только авторизованные пользователи могут удалять данные
DROP POLICY IF EXISTS "Allow authenticated users to delete typ_dezurstva" ON typ_dezurstva;
CREATE POLICY "Allow authenticated users to delete typ_dezurstva"
ON typ_dezurstva
FOR DELETE
TO authenticated
USING (true);

