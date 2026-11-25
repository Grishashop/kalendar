// Границы вчерашних гражданских суток в Москве, включая переход месяца и года.
export function previousMoscowDay(today: string) {
  const end = Date.parse(today + "T00:00:00+03:00");
  const start = end - 86400000;
  return { start, end, day: new Date(start + 10800000).toISOString().slice(0, 10) };
}

export function lastCloseInDay(rows: { time: number; close: number }[], start: number, end: number) {
  let latest = -Infinity;
  let close: number | null = null;
  for (const row of rows) {
    if (row.time >= start && row.time < end && row.time > latest && Number.isFinite(row.close) && row.close !== 0) {
      latest = row.time;
      close = row.close;
    }
  }
  return close;
}
