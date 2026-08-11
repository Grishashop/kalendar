// Загрузка снимка доступа из базы. Отделено от lib/access.ts, чтобы правило
// и кэш оставались без зависимостей от Supabase и проверялись без сети.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_MODES,
  PAGES,
  PUBLIC_CAPABLE,
  type AccessMode,
  type AccessSnapshot,
  type Page,
} from "./access";

/**
 * Забирает всю таблицу доступа. Связь «раздел → почта» собирается в JS, а не
 * встроенным запросом PostgREST: трейдеров десять, стоимость нулевая, зато нет
 * зависимости от того, как PostgREST разглядел внешний ключ.
 *
 * Бросает, если режимы не прочитались: вызывающий (getSnapshot) трактует это
 * как «таблиц нет» и отдаёт режимы по умолчанию.
 */
export async function loadSnapshot(
  supabase: SupabaseClient,
): Promise<AccessSnapshot> {
  const [modeRows, listRows, traderRows] = await Promise.all([
    supabase.from("page_access").select("page, mode"),
    supabase.from("page_access_trader").select("page, trader_id"),
    supabase.from("traders").select("id, mail"),
  ]);

  if (modeRows.error) throw modeRows.error;

  const modes = { ...DEFAULT_MODES };
  for (const row of (modeRows.data ?? []) as { page: string; mode: string }[]) {
    if (!PAGES.includes(row.page as Page)) continue;
    const page = row.page as Page;
    // Публичный режим у раздела с приватным токеном не принимаем, даже если он
    // каким-то образом оказался в базе: CHECK такое не запишет, но цена ошибки —
    // токен Alor анониму, и одной линии обороны для неё мало.
    if (row.mode === "public" && !PUBLIC_CAPABLE.includes(page)) continue;
    modes[page] = row.mode as AccessMode;
  }

  const mailById = new Map<number, string>();
  for (const row of (traderRows.data ?? []) as { id: number; mail: string | null }[]) {
    if (row.mail) mailById.set(row.id, row.mail.toLowerCase());
  }

  const allowed: Record<Page, string[]> = { market: [], karman: [], ticker: [] };
  for (const row of (listRows.data ?? []) as { page: string; trader_id: number }[]) {
    const mail = mailById.get(row.trader_id);
    if (mail && PAGES.includes(row.page as Page)) allowed[row.page as Page].push(mail);
  }

  return { modes, allowed };
}
