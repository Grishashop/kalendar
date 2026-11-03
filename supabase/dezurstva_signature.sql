-- ============================================================
-- Дешёвый fingerprint таблицы dezurstva для polling-фолбэка календаря.
--
-- Зачем: при недоступном Realtime клиент раз в 60с проверял изменения
-- полной выгрузкой (select "*"), ~93 КБ на запрос, ~130 МБ/сутки на одну
-- открытую вкладку — так сгорала egress-квота Supabase. Теперь клиент
-- сначала зовёт эту функцию: она возвращает md5 всей таблицы (~32 байта,
-- ~500 байт на RPC-запрос), и полная выгрузка идёт только если данные
-- реально изменились.
--
-- Почему md5, а не count/max(updated_at): у dezurstva нет колонки
-- updated_at, поэтомуUPDATE (например, переключение «утверждено») другими
-- дешёвыми способами не поймать.
--
-- Как применить: Dashboard → SQL Editor → вставить целиком → Run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.dezurstva_signature()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT md5(
    (SELECT count(*)::text || '|'
      FROM dezurstva)
    ||
    (SELECT coalesce(
      string_agg(
        id::text || date_dezurztva_or_otdyh::text || coalesce(traders, '')
        || coalesce(tip_dezursva_or_otdyh, '') || utverzdeno::text,
        ','
        ORDER BY id, date_dezurztva_or_otdyh
      ),
      '')
     FROM dezurstva)
  );
$$;

-- PostgREST выставляет RPC от имени вызывающего; SECURITY DEFINER обходит
-- RLS внутри функции, поэтому доступ даём всем существующим ролям.
GRANT EXECUTE ON FUNCTION public.dezurstva_signature() TO anon, authenticated;
