// Общие хелперы для работы с MOEX ISS API. Перенесены дословно из
// app/api/market/route.ts (рефакторинг без изменения поведения) — см. план
// «Справочник МосБиржи» — чтобы переиспользовать в новых API-роутах
// (/api/market/search, /api/market/info, /api/market/events).

// Превращает ISS-блок { columns, data } в массив объектов { COLUMN: value }.
export function parseIssTable(
  json: unknown,
  block: string,
): Record<string, unknown>[] {
  const table = (json as Record<string, unknown> | null)?.[block] as
    | { columns?: unknown; data?: unknown }
    | undefined;
  const columns = table?.columns;
  const data = table?.data;
  if (!Array.isArray(columns) || !Array.isArray(data)) return [];
  return (data as unknown[][]).map((row) => {
    const obj: Record<string, unknown> = {};
    (columns as string[]).forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

// MOEX ISS иногда отклоняет/таймаутит отдельные из параллельных запросов
// (Vercel в США, MOEX в Москве + троттлинг по IP). Поэтому: браузерный
// User-Agent, ограниченный таймаут на попытку и ретраи с backoff+jitter.
export const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (compatible; LavochkaMarketDashboard/1.0; +https://lavochka.vercel.app)",
  Accept: "application/json, text/javascript, */*",
};

export async function fetchJson(
  url: string,
  attempts = 3,
  timeoutMs = 9000,
  revalidateSeconds = 8,
): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        // no-store тут отключил бы Data Cache для этого fetch — с
        // export const dynamic = "force-dynamic" на сам route handler это
        // не влияет, но next.revalidate всё равно даёт дедупликацию
        // одинаковых URL в пределах revalidateSeconds без похода на MOEX/ЦБ.
        next: { revalidate: revalidateSeconds },
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
      // Парсим из текста: ЦБ отдаёт application/javascript, на котором
      // res.json() падает; для MOEX (application/json) JSON.parse тоже валиден.
      const text = await res.text();
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        const delay = 300 * (i + 1) + Math.floor(Math.random() * 300);
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, delay);
        await promise;
      }
    }
  }
  throw lastErr;
}

export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// last === 0 или отсутствует → сделок не было, показываем null.
export function lastOrNull(v: unknown): number | null {
  const n = num(v);
  return n && n !== 0 ? n : null;
}

// Сегодняшняя дата по МСК (UTC+3) в формате YYYY-MM-DD.
export function todayMsk(): string {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}
