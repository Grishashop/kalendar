export interface ProviderQuote {
  last: number;
  changePct?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  time?: string;
}

export function validPrice(quote: ProviderQuote | undefined): quote is ProviderQuote {
  return quote !== undefined && Number.isFinite(quote.last) && quote.last !== 0;
}

export function mergeQuoteRows(
  iss: Record<string, unknown>[],
  symbols: string[],
  priceField: "LAST" | "CURRENTVALUE",
  tbank: ReadonlyMap<string, ProviderQuote>,
  alor: ReadonlyMap<string, ProviderQuote>,
): Record<string, unknown>[] {
  const index = priceField === "CURRENTVALUE";
  const rows = new Map<string, Record<string, unknown>>();
  for (const row of iss) {
    const symbol = row.SECID;
    if (typeof symbol !== "string") continue;
    if (!rows.get(symbol)?.[priceField]) rows.set(symbol, row);
  }
  for (const symbol of symbols) {
    const primary = tbank.get(symbol);
    const quote = validPrice(primary) ? primary : alor.get(symbol);
    if (!validPrice(quote)) continue;
    const time = quote.time ? new Date(Date.parse(quote.time) + 10800000) : null;
    const msk = time && Number.isFinite(time.getTime()) ? time.toISOString() : null;
    rows.set(symbol, {
      ...rows.get(symbol),
      SECID: symbol,
      [priceField]: quote.last,
      [index ? "LASTCHANGEPRC" : "LASTTOPREVPRICE"]: quote.changePct ?? null,
      [index ? "OPENVALUE" : "OPEN"]: quote.open ?? null,
      HIGH: quote.high ?? null,
      LOW: quote.low ?? null,
      SETTLETOPREVSETTLEPRC: null,
      SYSTIME: msk?.slice(0, 19).replace("T", " ") ?? null,
      UPDATETIME: msk?.slice(11, 19) ?? null,
    });
  }
  return [...rows.values()];
}
