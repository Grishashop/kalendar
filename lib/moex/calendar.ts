// Границы вчерашних гражданских суток в Москве, включая переход месяца и года.
export function previousMoscowDay(today: string) {
  const end = Date.parse(today + "T00:00:00+03:00");
  const start = end - 86400000;
  return { start, end, day: new Date(start + 10800000).toISOString().slice(0, 10) };
}

export function lastCandleBefore(rows: { time: number; close: number }[], end: number) {
  let latest = -Infinity;
  let candle: { time: number; close: number } | null = null;
  for (const row of rows) {
    if (row.time < end && row.time > latest && Number.isFinite(row.close) && row.close !== 0) {
      latest = row.time;
      candle = row;
    }
  }
  return candle;
}

// Дата сделки, а не запроса: после полуночи последняя цена всё ещё
// относится к предыдущей сессии.
export function quoteSessionDay(time: number): string | null {
  if (!Number.isFinite(time) || time <= 0) return null;
  return new Date(time + 10800000).toISOString().slice(0, 10);
}

// ISS SYSTIME датирует публикацию сводки. Котировка может быть старше.
export function preferIndexCandle(candleTime?: string, quoteTime?: string): boolean {
  const candle = Date.parse(candleTime ?? "");
  const quote = Date.parse(quoteTime ?? "");
  return Number.isFinite(candle) && (!Number.isFinite(quote) || candle > quote);
}
