import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { InstrumentKind, WatchItem } from "@/lib/ticker/instruments";
import { watchItemFromSearchResult } from "@/lib/ticker/instruments";
import { listAllSecurities } from "@/lib/ticker/alor";

const UPSERT_CHUNK = 500;

/**
 * Внутренняя база инструментов Московской биржи (таблица `ticker_instruments` в
 * Supabase Postgres, см. supabase/ticker_instruments.sql) — источник для поиска в
 * приложении, без обращений к Alor на каждый набор символа. Перенесено из отдельного
 * проекта StockTicker (там была своя Neon Postgres + drizzle-orm); ранжирование поиска
 * и fuzzy-фолбэк (pg_trgm) живут в SQL-функции `ticker_search_instruments` — вызывается
 * через supabase.rpc(), а не собираются на лету через query-builder.
 */

interface InstrumentRow {
  symbol: string;
  shortname: string;
  description: string;
  kind: string;
  isin: string | null;
  currency: string;
  facevalue: number;
  cancellation: string | null;
  minstep: number;
  board: string;
  exchange: string;
  underlying_name: string | null;
}

function rowToWatchItem(row: InstrumentRow): WatchItem {
  return {
    exchange: row.exchange,
    symbol: row.symbol,
    shortname: row.shortname,
    description: row.description,
    kind: row.kind as InstrumentKind,
    isin: row.isin,
    currency: row.currency,
    facevalue: row.facevalue,
    cancellation: row.cancellation,
    minstep: row.minstep,
    board: row.board,
    underlyingName: row.underlying_name,
  };
}

export interface SearchOutcome {
  results: WatchItem[];
  /** true — точных совпадений не нашлось, это подсказки "возможно, вы искали" (включая ISIN). */
  fuzzy: boolean;
}

/** Поиск по внутренней БД (только MOEX): тикер, краткое/полное название, ISIN. */
export async function searchInstruments(query: string): Promise<SearchOutcome> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ticker_search_instruments", {
    q: query,
  });
  if (error) throw error;
  const rows = (data ?? []) as (InstrumentRow & { is_fuzzy: boolean })[];
  return {
    results: rows.map(rowToWatchItem),
    // Пустой результат возможен только из fuzzy-ветки SQL-функции (exact-ветка
    // выполняется, только если там гарантированно есть хотя бы одна строка).
    fuzzy: rows.length === 0 ? true : rows[0].is_fuzzy,
  };
}

export interface SyncStatus {
  count: number;
  lastSyncedAt: string | null;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const supabase = await createClient();
  const { data, count, error } = await supabase
    .from("ticker_instruments")
    .select("updated_at", { count: "exact" })
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return {
    count: count ?? 0,
    lastSyncedAt: data?.[0]?.updated_at ?? null,
  };
}

/**
 * Полная актуализация внутренней БД из Alor: тянем весь список инструментов MOEX
 * (требует токен — анонимно недоступно, см. lib/ticker/alor.ts:listAllSecurities) и
 * заменяем содержимое таблицы. Вместо "удалить всё, затем вставить" делаем upsert
 * свежих строк, а затем чистим то, что не пришло в этом списке (делистинг) — так
 * таблица никогда не бывает пустой на середине операции.
 */
export async function syncInstruments(): Promise<SyncStatus> {
  const securities = await listAllSecurities("MOEX");
  const syncedAt = new Date();
  const rows = securities
    .filter((security) => security.exchange === "MOEX")
    .map((security) => ({
      ...watchItemFromSearchResult(security),
      updatedAt: syncedAt,
    }))
    // Приложение — про акции/облигации/фьючерсы; опционы и прочие производные
    // (cfiCode "O..." и т.п., classify() -> "other") в базу не идут — иначе десятки
    // тысяч опционных серий забивают поиск и совсем не то, о чём брокеру звонят клиенты.
    .filter((item) => item.kind !== "other");

  // У фьючерсов shortname/description — внутренние коды экспирации ("AFU6"), без названия
  // базового актива, поэтому "Аэрофлот" их не находит. Тикер фьючерса устроен как
  // "БАЗА-MM.YY" (в т.ч. календарные спреды "БАЗА-MM.YY-MM.YY") — код базового актива
  // совпадает с тикером акции, если она есть в этой же выгрузке. Заполняем underlyingName —
  // используется и для поиска, и для отображения (список избранного, карточка инструмента).
  const stockNameBySymbol = new Map(
    rows.filter((item) => item.kind === "stock").map((item) => [item.symbol, item.shortname]),
  );
  for (const item of rows) {
    if (item.kind !== "futures") continue;
    const baseSymbol = item.symbol.split("-")[0];
    item.underlyingName = stockNameBySymbol.get(baseSymbol) ?? null;
  }

  const dbRows = rows.map((item) => ({
    symbol: item.symbol,
    shortname: item.shortname,
    description: item.description,
    kind: item.kind,
    isin: item.isin,
    currency: item.currency,
    facevalue: item.facevalue,
    cancellation: item.cancellation,
    minstep: item.minstep,
    board: item.board,
    exchange: item.exchange,
    underlying_name: item.underlyingName,
    updated_at: item.updatedAt.toISOString(),
  }));

  const supabase = await createClient();

  for (let i = 0; i < dbRows.length; i += UPSERT_CHUNK) {
    const chunk = dbRows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from("ticker_instruments")
      .upsert(chunk, { onConflict: "symbol" });
    if (error) throw error;
  }

  // То, что не встретилось в свежем списке (делистинг/переименование) — убираем.
  const { error: deleteError } = await supabase
    .from("ticker_instruments")
    .delete()
    .lt("updated_at", syncedAt.toISOString());
  if (deleteError) throw deleteError;

  return { count: dbRows.length, lastSyncedAt: syncedAt.toISOString() };
}
