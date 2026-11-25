import type { MarketResponse, Quote } from "../../app/api/market/route";

export function restoreMissing(fresh: MarketResponse, previous?: MarketResponse | null) {
  if (!previous) return fresh;
  const sameDay = fresh.calendarDay === previous.calendarDay;
  function combine<T extends Quote>(current: T[], old: T[], key = (q: T) => q.secid) {
    const result = current.filter(q => q.last !== null);
    const keys = new Set(result.map(key));
    for (const q of old) {
      if (keys.has(key(q)) || q.last === null || !q.receivedAt ||
          Date.now() - Date.parse(q.receivedAt) > 7 * 86400000) continue;
      result.push({ ...q, cached: true, changePct: sameDay ? q.changePct : null,
        future: q.future && {...q.future, changePct: sameDay ? q.future.changePct : null},
        cbr: q.cbr && {...q.cbr, changePct: sameDay ? q.cbr.changePct : null} });
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
