-- Закрытие дыр, найденных сверкой живой базы (прод Lavochka) с репозиторием.
-- Идемпотентно. Запускать после security_hardening.sql.
--
-- Найдено в проде:
--   1. search_notes(p_trader_id, ...) — SECURITY DEFINER без проверки владельца,
--      EXECUTE у anon. Любой с публичным ключом мог читать заметки любого трейдера
--      (id — bigserial, перебирается). Приложение функцию не вызывает.
--   2. traders DELETE USING (true) для любого вошедшего (в репозитории — «только
--      админ»). Любой вошедший мог удалить любого трейдера, а каскад сносит его
--      записи в списках доступа.
--   3. traders UPDATE USING/CHECK (true) у любого вошедшего: чужие имя, фото,
--      телефон правились свободно (права и почту защищает триггер).
--   4. SECURITY DEFINER-функции были доступны anon через /rest/v1/rpc.

-- ============================================================
-- 1. search_notes: работать с правами вызывающего (RLS на notes сам отсечёт
--    чужие заметки) и не отдавать анониму
-- ============================================================
ALTER FUNCTION public.search_notes(bigint, text, bigint, text[], boolean)
  SECURITY INVOKER
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.search_notes(bigint, text, bigint, text[], boolean)
  FROM PUBLIC, anon;

-- ============================================================
-- 2. traders: удаление — админу, правка — себе или админу
-- ============================================================
DROP POLICY IF EXISTS "Allow authenticated users to delete traders" ON traders;
DROP POLICY IF EXISTS "Allow admins to delete traders" ON traders;
CREATE POLICY "Allow admins to delete traders"
ON traders
FOR DELETE
TO authenticated
USING (is_admin());

DROP POLICY IF EXISTS "Allow authenticated users to update traders" ON traders;
CREATE POLICY "Allow authenticated users to update traders"
ON traders
FOR UPDATE
TO authenticated
USING (lower(mail) = lower(get_user_email()) OR is_admin())
WITH CHECK (lower(mail) = lower(get_user_email()) OR is_admin());

-- ============================================================
-- 3. notes: у UPDATE не было WITH CHECK — можно было перенести заметку другому
--    трейдеру. Проверка на новой строке та же, что на старой.
-- ============================================================
DROP POLICY IF EXISTS "Allow traders to update their own notes" ON notes;
CREATE POLICY "Allow traders to update their own notes"
ON notes
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = notes.trader_id
    AND lower(traders.mail) = lower(get_user_email())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM traders
    WHERE traders.id = notes.trader_id
    AND lower(traders.mail) = lower(get_user_email())
  )
);

-- ============================================================
-- 4. Функции не должны вызываться анонимом через REST
--    (политики для anon их не вычисляют: у anon только SELECT USING (true))
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.get_user_email() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_note(bigint) FROM PUBLIC, anon;
-- Триггерной функции право EXECUTE при срабатывании не нужно.
REVOKE EXECUTE ON FUNCTION public.traders_guard_privileged_columns() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.soft_delete_note(bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_temp;
