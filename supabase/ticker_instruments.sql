-- Внутренняя база инструментов Московской биржи для раздела «Монитор котировок»
-- (перенесено из отдельного проекта StockTicker, Neon+drizzle -> Supabase Postgres).
-- Источник данных — Alor OpenAPI (GET /md/v2/Securities/MOEX), заполняется/актуализируется
-- вручную кнопкой «Актуализировать» (POST /api/ticker/instruments/sync). Только MOEX.

-- ============================================
-- 1. Расширение для триграммного fuzzy-поиска
-- ============================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- 2. Таблица ticker_instruments
-- ============================================
CREATE TABLE IF NOT EXISTS ticker_instruments (
  symbol TEXT PRIMARY KEY,
  shortname TEXT NOT NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL, -- stock | bond | futures (opционы/прочее в базу не идут)
  isin TEXT,
  currency TEXT NOT NULL,
  facevalue DOUBLE PRECISION NOT NULL,
  cancellation TEXT,
  minstep DOUBLE PRECISION NOT NULL,
  board TEXT NOT NULL,
  exchange TEXT NOT NULL,
  -- Только у фьючерсов: читаемое имя базового актива ("Аэрофлот" для AFLT-9.26), если найдено.
  underlying_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Триграммные индексы — под похожий (fuzzy) поиск, когда точных совпадений нет.
CREATE INDEX IF NOT EXISTS idx_ticker_instruments_symbol_trgm ON ticker_instruments USING gin (symbol gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ticker_instruments_shortname_trgm ON ticker_instruments USING gin (shortname gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ticker_instruments_description_trgm ON ticker_instruments USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ticker_instruments_isin ON ticker_instruments (isin);

-- ============================================
-- 3. RLS — та же схема, что у остальных общих справочных таблиц в проекте
--    (см. dezurstva.sql): SELECT всем авторизованным, мутации тоже только
--    авторизованным (раздел целиком закрыт входом в kalendar на уровне middleware).
-- ============================================
ALTER TABLE ticker_instruments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users to read ticker_instruments" ON ticker_instruments;
CREATE POLICY "Allow authenticated users to read ticker_instruments"
ON ticker_instruments
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to write ticker_instruments" ON ticker_instruments;
CREATE POLICY "Allow authenticated users to write ticker_instruments"
ON ticker_instruments
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- ============================================
-- 4. Поиск инструментов — точный, с фолбэком на fuzzy (триграммы), одной
--    функцией: PostgREST/JS-клиент из drizzle-версии не переносится дословно
--    (raw SQL-ранжирование там строилось на лету), поэтому логика ранжирования
--    перенесена в SQL-функцию, вызывается через supabase.rpc().
--
--    Приоритет точного совпадения: точный тикер > тикер-префикс > точный ISIN >
--    точное имя > имя/описание с этого префикса > "слово" в названии после
--    дефиса/пробела (бренд "Т-", напр. "Т-Технологии") > остальные совпадения
--    где-то внутри. Внутри уровня: акции/фьючерсы впереди облигаций (у эмитента
--    обычно много похожих по названию облигационных выпусков).
--
--    Fuzzy (если точных совпадений нет): similarity() по коротким полям
--    (тикер/название/ISIN/базовый актив), word_similarity() по описанию
--    (длинные строки — оцениваем лучшее совпадение внутри, а не всю строку).
-- ============================================
CREATE OR REPLACE FUNCTION ticker_search_instruments(
  q TEXT,
  search_limit INT DEFAULT 15,
  fuzzy_limit INT DEFAULT 8,
  min_similarity REAL DEFAULT 0.2
)
RETURNS TABLE (
  symbol TEXT,
  shortname TEXT,
  description TEXT,
  kind TEXT,
  isin TEXT,
  currency TEXT,
  facevalue DOUBLE PRECISION,
  cancellation TEXT,
  minstep DOUBLE PRECISION,
  board TEXT,
  exchange TEXT,
  underlying_name TEXT,
  is_fuzzy BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  pattern TEXT := '%' || q || '%';
BEGIN
  IF EXISTS (
    SELECT 1 FROM ticker_instruments i
    WHERE i.symbol ILIKE pattern OR i.shortname ILIKE pattern OR i.description ILIKE pattern
       OR i.isin ILIKE pattern OR i.underlying_name ILIKE pattern
  ) THEN
    RETURN QUERY
    SELECT i.symbol, i.shortname, i.description, i.kind, i.isin, i.currency, i.facevalue,
           i.cancellation, i.minstep, i.board, i.exchange, i.underlying_name, false AS is_fuzzy
    FROM ticker_instruments i
    WHERE i.symbol ILIKE pattern OR i.shortname ILIKE pattern OR i.description ILIKE pattern
       OR i.isin ILIKE pattern OR i.underlying_name ILIKE pattern
    ORDER BY
      (CASE
        WHEN i.symbol ILIKE q THEN 0
        WHEN i.symbol ILIKE q || '%' THEN 1
        WHEN i.isin ILIKE q THEN 2
        WHEN i.shortname ILIKE q THEN 3
        WHEN i.shortname ILIKE q || '%' THEN 4
        WHEN i.underlying_name ILIKE q || '%' THEN 4
        WHEN i.shortname ILIKE '%-' || q || '%' THEN 5
        WHEN i.shortname ILIKE '% ' || q || '%' THEN 5
        WHEN i.underlying_name ILIKE '%-' || q || '%' THEN 5
        WHEN i.underlying_name ILIKE '% ' || q || '%' THEN 5
        WHEN i.description ILIKE q || '%' THEN 6
        ELSE 7
      END),
      (CASE WHEN i.kind = 'bond' THEN 2 WHEN i.kind = 'futures' THEN 1 ELSE 0 END),
      length(i.shortname),
      i.symbol
    LIMIT search_limit;
  ELSE
    RETURN QUERY
    SELECT i.symbol, i.shortname, i.description, i.kind, i.isin, i.currency, i.facevalue,
           i.cancellation, i.minstep, i.board, i.exchange, i.underlying_name, true AS is_fuzzy
    FROM ticker_instruments i
    WHERE greatest(
      similarity(i.symbol, q),
      similarity(i.shortname, q),
      word_similarity(q, i.description),
      similarity(coalesce(i.isin, ''), q),
      similarity(coalesce(i.underlying_name, ''), q)
    ) > min_similarity
    ORDER BY
      (CASE WHEN i.kind = 'bond' THEN 2 WHEN i.kind = 'futures' THEN 1 ELSE 0 END),
      greatest(
        similarity(i.symbol, q),
        similarity(i.shortname, q),
        word_similarity(q, i.description),
        similarity(coalesce(i.isin, ''), q),
        similarity(coalesce(i.underlying_name, ''), q)
      ) DESC,
      i.symbol
    LIMIT fuzzy_limit;
  END IF;
END;
$$;
