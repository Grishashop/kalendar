import type { MarketResponse, Quote } from "../../app/api/market/route";

export function restoreMissing(fresh: MarketResponse, previous?: MarketResponse | null) {
  if (!previous) return fresh;
  for (const index of ["imoex", "rtsi"] as const) {
    const priorDay = previous.sparkDays?.[index] ?? previous.calendarDay;
    const freshDay = fresh.sparkDays?.[index] ?? fresh.calendarDay;
    if (priorDay && previous.sparklines[index].length >= 2 &&
      (fresh.sparklines[index].length < 2 || (freshDay && priorDay > freshDay))) {
      fresh.sparklines[index] = previous.sparklines[index];
      (fresh.sparkDays ??= {})[index] = priorDay;
    }
  }
  function combine<T extends Quote>(current: T[], old: T[], key = (q: T) => q.secid) {
    const result = current.filter(q => q.last !== null);
    // Повтор той же сделки при временно недоступной истории свечей.
    for (const q of result) {
      if (q.changePct !== null || !q.observedAt) continue;
      const prior = old.find(row => row.secid === q.secid && row.observedAt === q.observedAt && row.last === q.last);
      if (prior) q.changePct = prior.changePct;
    }
    const keys = new Set(result.map(key));
    for (const q of old) {
      if (keys.has(key(q)) || q.last === null || !q.receivedAt ||
          Date.now() - Date.parse(q.receivedAt) > 7 * 86400000) continue;
      result.push({ ...q, cached: true });
    }
    return result;
  }
  fresh.indices = combine(fresh.indices, previous.indices);
  fresh.stocks = combine(fresh.stocks, previous.stocks);
  fresh.currencies = combine(fresh.currencies, previous.currencies, q => q.secid.slice(0, 3));
  fresh.commodities = combine(fresh.commodities, previous.commodities, q => q.name);
  for (const group of previous.sectorStocks) {
    const current = fresh.sectorStocks.find(g => g.sector === group.sector);
    const quotes = combine(current?.quotes ?? [], group.quotes);
    if (current) current.quotes = quotes;
    else if (quotes.length) fresh.sectorStocks.push({sector: group.sector, quotes});
  }
  return fresh;
}
