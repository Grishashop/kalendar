-- RLS политики для таблицы dezurstva

-- Включаем RLS для таблицы dezurstva
ALTER TABLE dezurstva ENABLE ROW LEVEL SECURITY;

-- Политика SELECT: все пользователи (включая анонимных) могут просматривать данные
CREATE POLICY "Allow all users to read dezurstva"
ON dezurstva
FOR SELECT
USING (true);

-- Политика INSERT: только авторизованные пользователи могут добавлять данные
CREATE POLICY "Allow authenticated users to insert dezurstva"
ON dezurstva
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Политика UPDATE: только авторизованные пользователи могут обновлять данные
CREATE POLICY "Allow authenticated users to update dezurstva"
ON dezurstva
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Политика DELETE: только авторизованные пользователи могут удалять данные
CREATE POLICY "Allow authenticated users to delete dezurstva"
ON dezurstva
FOR DELETE
TO authenticated
USING (true);

