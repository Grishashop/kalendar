import "server-only";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 7000;

export interface IssTable {
  columns: string[];
  data: unknown[][];
}

/** Универсальный фетч ответа MOEX ISS с несколькими именованными блоками (dividends, coupons, ...). */
export async function fetchIssBlocks(url: string): Promise<Record<string, IssTable | undefined>> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, IssTable | undefined>;
  } catch {
    return {};
  }
}

/** Превращает { columns, data } в массив объектов { колонка: значение }. */
export function issRowsToObjects(table: IssTable): Record<string, unknown>[] {
  return table.data.map((row) => Object.fromEntries(table.columns.map((column, i) => [column, row[i]])));
}
