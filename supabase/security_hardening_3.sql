-- Закрытие анонимного чтения traders (почты и телефоны всей команды).
-- Запускать ПОСЛЕ выката кода с разделёнными областями кэша доступа
-- (lib/access.ts, SnapshotScope), иначе анонимный запрос к публичному /market
-- может на 30 секунд загрузить снимок без почт, и допущенные по списку
-- (сейчас это «Карман») получат отказ.
--
-- Что нужно анонимной главной: календарь читает из traders только id и
-- name_short дежурящих (components/calendar.tsx, фильтр по трейдерам).
-- Решение без view и SECURITY DEFINER: колоночные права + отдельная политика.
--   * anon: SELECT только колонок id, name_short, mozno_dezurit и только строк
--     с mozno_dezurit = true. `select *` или запрос mail/phone у anon даст
--     ошибку прав.
--   * authenticated: читает всё, как раньше (справочник команды в приложении).
-- Идемпотентно.

-- 1. Вошедшим — прежнее поведение
DROP POLICY IF EXISTS "Allow all users to read traders" ON traders;
DROP POLICY IF EXISTS "Allow authenticated users to read traders" ON traders;
CREATE POLICY "Allow authenticated users to read traders"
ON traders
FOR SELECT
TO authenticated
USING (true);

-- 2. Анониму — только дежурящие и только безобидные колонки
DROP POLICY IF EXISTS "Allow anon to read duty traders" ON traders;
CREATE POLICY "Allow anon to read duty traders"
ON traders
FOR SELECT
TO anon
USING (mozno_dezurit = true);

REVOKE SELECT ON TABLE traders FROM anon;
GRANT SELECT (id, name_short, mozno_dezurit) ON TABLE traders TO anon;

-- Проверка (под ролью anon через REST):
--   GET /rest/v1/traders?select=id,name_short&mozno_dezurit=eq.true  -> 200
--   GET /rest/v1/traders?select=mail                                 -> 401/403
--   GET /rest/v1/traders?select=*                                    -> 401/403
