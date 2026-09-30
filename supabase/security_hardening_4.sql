-- Перенос правил «кто что может с дежурствами» из интерфейса в RLS.
--
-- Сейчас dezurstva и typ_dezurstva разрешают любому вошедшему вставлять,
-- менять и удалять всё (USING (true)). Правила «не админ удаляет только свою
-- неутверждённую запись» и «утверждает только админ» живут лишь в
-- components/day-details-card.tsx и add-duty-card.tsx, то есть обходятся
-- прямым запросом к REST с обычной сессией.
--
-- dezurstva.traders хранит traders.name_short (TEXT, не id, с точностью до
-- пробелов), поэтому «своя запись» — совпадение name_short трейдера с почтой
-- из токена. traders читаются всеми вошедшими (security_hardening_3.sql),
-- подзапрос под политикой работает.
--
-- typ_dezurstva: приложение его только читает (admin-panel тоже), правка
-- справочника — через SQL Editor или админом.
--
-- ticker_instruments не трогаем: там публичные данные MOEX, пишет только
-- серверный синк «Актуализировать» под сессией вошедшего, а раздел закрыт
-- режимом доступа; потеря данных лечится повторной синхронизацией.
--
-- Порядок: применять после security_hardening_2.sql (is_admin, get_user_email).
-- Идемпотентно: каждая политика сначала DROP IF EXISTS, потом CREATE.

-- ============================================
-- dezurstva
-- ============================================
DROP POLICY IF EXISTS "Allow authenticated users to insert dezurstva" ON dezurstva;
CREATE POLICY "Allow authenticated users to insert dezurstva"
ON dezurstva
FOR INSERT
TO authenticated
WITH CHECK (
  is_admin()
  OR (
    COALESCE(utverzdeno, false) = false
    AND EXISTS (
      SELECT 1 FROM traders t
      WHERE lower(t.mail) = lower(get_user_email())
        AND t.name_short = dezurstva.traders
    )
  )
);

-- Менять запись (утверждать) может только админ: других UPDATE в коде нет.
DROP POLICY IF EXISTS "Allow authenticated users to update dezurstva" ON dezurstva;
DROP POLICY IF EXISTS "Allow admins to update dezurstva" ON dezurstva;
CREATE POLICY "Allow admins to update dezurstva"
ON dezurstva
FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow authenticated users to delete dezurstva" ON dezurstva;
CREATE POLICY "Allow authenticated users to delete dezurstva"
ON dezurstva
FOR DELETE
TO authenticated
USING (
  is_admin()
  OR (
    utverzdeno IS NOT TRUE
    AND EXISTS (
      SELECT 1 FROM traders t
      WHERE lower(t.mail) = lower(get_user_email())
        AND t.name_short = dezurstva.traders
    )
  )
);

-- ============================================
-- typ_dezurstva: запись только админу
-- ============================================
DROP POLICY IF EXISTS "Allow authenticated users to insert typ_dezurstva" ON typ_dezurstva;
DROP POLICY IF EXISTS "Allow admins to insert typ_dezurstva" ON typ_dezurstva;
CREATE POLICY "Allow admins to insert typ_dezurstva"
ON typ_dezurstva
FOR INSERT
TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow authenticated users to update typ_dezurstva" ON typ_dezurstva;
DROP POLICY IF EXISTS "Allow admins to update typ_dezurstva" ON typ_dezurstva;
CREATE POLICY "Allow admins to update typ_dezurstva"
ON typ_dezurstva
FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow authenticated users to delete typ_dezurstva" ON typ_dezurstva;
DROP POLICY IF EXISTS "Allow admins to delete typ_dezurstva" ON typ_dezurstva;
CREATE POLICY "Allow admins to delete typ_dezurstva"
ON typ_dezurstva
FOR DELETE
TO authenticated
USING (is_admin());

-- Проверка под обычным (не админ) вошедшим, в SQL Editor:
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"email":"<почта трейдера>"}', true);
--   insert into dezurstva (date_dezurztva_or_otdyh, traders, tip_dezursva_or_otdyh)
--     values (current_date, '<name_short ДРУГОГО трейдера>', '<тип>');  -- ошибка RLS
--   insert into dezurstva (date_dezurztva_or_otdyh, traders, tip_dezursva_or_otdyh, utverzdeno)
--     values (current_date, '<свой name_short>', '<тип>', true);        -- ошибка RLS
--   update dezurstva set utverzdeno = true where id = <id>;             -- 0 строк
--   insert into typ_dezurstva (tip_dezursva_or_otdyh) values ('x');     -- ошибка RLS
--   rollback;
