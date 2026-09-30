-- Закрытие дыр в RLS. Идемпотентно: можно запускать повторно.
-- Запускать в Supabase SQL Editor (там auth.uid() = NULL, триггер ниже
-- это пропускает, поэтому правки из дашборда не блокируются).
--
-- Что чинит:
--   1. Любой вошедший мог вставить в traders строку с admin = true
--      или обновить своей строке admin / chat / zametki / mozno_dezurit.
--   2. Любой вошедший мог удалить чужое сообщение в чате
--      (политика DELETE стояла с USING (true), хотя комментарий говорил «автор»).
--   3. get_user_email() был SECURITY DEFINER без фиксированного search_path.

-- ============================================================
-- 0. Вспомогательные функции
-- ============================================================

-- SECURITY DEFINER без search_path позволял подменить функции через
-- схему в пути поиска. Фиксируем путь.
CREATE OR REPLACE FUNCTION get_user_email()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN (auth.jwt() ->> 'email');
END;
$$;

-- Проверка «текущий вошедший — администратор». SECURITY DEFINER нужен, чтобы
-- политики на traders не упирались в рекурсию RLS при чтении той же таблицы.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM traders
    WHERE lower(traders.mail) = lower(auth.jwt() ->> 'email')
      AND traders.admin = true
  );
$$;

-- ============================================================
-- 1. traders: вставка и защита флагов
-- ============================================================

-- Обычный вошедший может завести только СВОЮ карточку (форма
-- «Добавить себя в список трейдеров») и только с выключенными правами.
-- Админ может вставить что угодно.
DROP POLICY IF EXISTS "Allow authenticated users to insert traders" ON traders;
CREATE POLICY "Allow authenticated users to insert traders"
ON traders
FOR INSERT
TO authenticated
WITH CHECK (
  is_admin()
  OR (
    lower(mail) = lower(get_user_email())
    AND COALESCE(admin, false) = false
    AND COALESCE(mozno_dezurit, false) = false
    AND COALESCE(chat, false) = false
    AND COALESCE(zametki, false) = false
  )
);

-- RLS не умеет ограничивать колонки в UPDATE: политика «правь свою строку»
-- разрешала поставить себе admin = true. Закрываем триггером: не-админ
-- не может менять права и почту. Без сессии (SQL Editor, service role)
-- auth.uid() = NULL — пропускаем.
CREATE OR REPLACE FUNCTION traders_guard_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.admin         IS DISTINCT FROM OLD.admin
  OR NEW.mozno_dezurit IS DISTINCT FROM OLD.mozno_dezurit
  OR NEW.chat          IS DISTINCT FROM OLD.chat
  OR NEW.zametki       IS DISTINCT FROM OLD.zametki
  OR NEW.mail          IS DISTINCT FROM OLD.mail THEN
    RAISE EXCEPTION 'Права и почту трейдера может менять только администратор'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS traders_guard_privileged_columns ON traders;
CREATE TRIGGER traders_guard_privileged_columns
  BEFORE UPDATE ON traders
  FOR EACH ROW
  EXECUTE FUNCTION traders_guard_privileged_columns();

-- ============================================================
-- 2. chat_messages: удалять можно только своё
-- ============================================================
DROP POLICY IF EXISTS "Allow authors to delete their own messages" ON chat_messages;
CREATE POLICY "Allow authors to delete their own messages"
ON chat_messages
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = chat_messages.author_id
    AND lower(traders.mail) = lower(get_user_email())
  )
);

-- ============================================================
-- Не тронуто намеренно (см. обзор, нужно решение владельца):
--   * traders SELECT USING (true) — читается анонимно, включая почты и телефоны.
--     Нужно выяснить, читает ли анонимная главная эту таблицу.
--   * dezurstva / typ_dezurstva — запись любым вошедшим (возможно, задумано).
--   * ticker_instruments FOR ALL любым вошедшим — пишет серверный sync.
-- ============================================================
