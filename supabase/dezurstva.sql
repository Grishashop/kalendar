-- SQL скрипт для создания таблицы dezurstva с RLS политиками

-- ============================================
-- 1. Создание таблицы dezurstva
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

-- Индексы
CREATE INDEX IF NOT EXISTS idx_dezurstva_date ON dezurstva(date_dezurztva_or_otdyh);
CREATE INDEX IF NOT EXISTS idx_dezurstva_traders ON dezurstva(traders);
CREATE INDEX IF NOT EXISTS idx_dezurstva_utverzdeno ON dezurstva(utverzdeno);

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
CREATE TRIGGER update_dezurstva_updated_at
  BEFORE UPDATE ON dezurstva
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 3. RLS политики для dezurstva
-- ============================================
ALTER TABLE dezurstva ENABLE ROW LEVEL SECURITY;

-- SELECT: все пользователи (включая анонимных) могут просматривать данные
DROP POLICY IF EXISTS "Allow all users to read dezurstva" ON dezurstva;
CREATE POLICY "Allow all users to read dezurstva"
ON dezurstva
FOR SELECT
USING (true);

-- INSERT: только авторизованные пользователи могут добавлять данные
DROP POLICY IF EXISTS "Allow authenticated users to insert dezurstva" ON dezurstva;
CREATE POLICY "Allow authenticated users to insert dezurstva"
ON dezurstva
FOR INSERT
TO authenticated
WITH CHECK (true);

-- UPDATE: только авторизованные пользователи могут обновлять данные
DROP POLICY IF EXISTS "Allow authenticated users to update dezurstva" ON dezurstva;
CREATE POLICY "Allow authenticated users to update dezurstva"
ON dezurstva
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- DELETE: только авторизованные пользователи могут удалять данные
DROP POLICY IF EXISTS "Allow authenticated users to delete dezurstva" ON dezurstva;
CREATE POLICY "Allow authenticated users to delete dezurstva"
ON dezurstva
FOR DELETE
TO authenticated
USING (true);

