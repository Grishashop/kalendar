import { NextResponse } from "next/server";
import { fetchJson, parseIssTable, todayMsk } from "@/lib/moex/iss";
import { SECTOR_GROUPS } from "@/lib/moex/sectors";
import {
  TICKER_TO_TBANK_UID,
  getDividendsByUid,
  getAllDividendPayingShares,
  dividendDateRange,
} from "@/lib/tbank/invest";

// Сводные события рынка для /market/info: дивиденды по ВСЕМ дивидендным
// акциям TQBR (площадка MOEX, полная вселенная из T-Bank Shares(), см.
// getAllDividendPayingShares) и ближайшие по экспирации фронт-контракты
// FORTS по каждому базовому активу.

export const maxDuration = 45;

export interface EventDividend {
  secid: string;
  name: string;
  date: string;
  value: number;
  currency: string;
  price: number | null; // текущая цена акции (MOEX ISS, TQBR, LAST)
  yieldPct: number | null; // дивидендная доходность = value / price * 100
}

export interface EventExpiration {
  secid: string;
  shortName: string;
  assetCode: string;
  name: string;
  lastTradeDate: string;
}

export interface EventsResponse {
  dividends: { upcoming: EventDividend[]; recent: EventDividend[] };
  expirations: EventExpiration[];
}

// Фолбэк-вселенная на случай, если bulk-запрос T-Bank Shares() недоступен
// (нет токена, сбой сети) — прежний вручную отобранный список ~40 самых
// весомых по IMOEX бумаг.
const FALLBACK_TICKERS = SECTOR_GROUPS.flatMap((g) => g.items);

const URL_FORTS_FRONTS =
  "https://iss.moex.com/iss/engines/futures/markets/forts/securities.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,SECNAME,ASSETCODE,LASTTRADEDATE&marketdata.columns=SECID,VALTODAY,OPENPOSITION";

// Текущие цены разом по всему TQBR-табло — один bulk-запрос вместо
// отдельного похода за ценой на каждую бумагу дивидендного календаря.
const URL_STOCKS_ALL_PRICES =
  "https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,LAST";

async function loadPrices(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  try {
    const json = await fetchJson(URL_STOCKS_ALL_PRICES, 2, 9000, 60);
    parseIssTable(json, "marketdata").forEach((r) => {
      const secid = r["SECID"];
      const last = r["LAST"];
      if (typeof secid === "string" && typeof last === "number" && last > 0) {
        prices.set(secid, last);
      }
    });
  } catch {
    // Цену/доходность просто не покажем — сами дивиденды это не блокирует.
  }
  return prices;
}

// Вселенная дивидендного календаря: тикер + T-Bank UID (известен заранее,
// без похода за резолвом) + название. Основной источник — bulk Shares()
// T-Bank (divYieldFlag = реально платит дивиденды, ~185 бумаг TQBR);
// провал bulk-запроса → фиксированный список из SECTOR_GROUPS.
async function loadDividendUniverse(): Promise<
  { secid: string; name: string; uid: string | null }[]
> {
  try {
    const shares = await getAllDividendPayingShares();
    if (shares.length > 0) {
      return shares.map((s) => ({ secid: s.ticker, name: s.name, uid: s.uid }));
    }
  } catch {
    // Падаем на фиксированный список ниже.
  }
  return FALLBACK_TICKERS.map((t) => ({
    secid: t.secid,
    name: t.name,
    uid: TICKER_TO_TBANK_UID[t.secid] ?? null,
  }));
}

// T-Bank Invest API (см. lib/tbank/invest.ts) отдаёт заметно более свежие
// дивиденды, чем MOEX ISS — используется первым (uid уже известен из
// loadDividendUniverse, повторный резолв не нужен); MOEX ISS остаётся
// фолбэком на конкретный тикер, если T-Bank не настроен или запрос не удался.
async function loadDividendsForTicker(
  secid: string,
  name: string,
  uid: string | null,
  fromIso: string,
  toIso: string,
): Promise<Omit<EventDividend, "price" | "yieldPct">[]> {
  if (uid) {
    try {
      const rows = await getDividendsByUid(uid, fromIso, toIso);
      return rows.map((r) => ({
        secid,
        name,
        date: r.recordDate,
        value: r.value,
        currency: r.currency,
      }));
    } catch {
      // Падаем на MOEX ISS ниже.
    }
  }

  const json = await fetchJson(
    "https://iss.moex.com/iss/securities/" +
      encodeURIComponent(secid) +
      "/dividends.json?iss.meta=off",
    2,
    9000,
    21600,
  );
  return parseIssTable(json, "dividends").map((r) => ({
    secid,
    name,
    date: String(r["registryclosedate"] ?? ""),
    value: typeof r["value"] === "number" ? r["value"] : 0,
    currency: String(r["currencyid"] ?? ""),
  }));
}

async function loadDividends(): Promise<{
  upcoming: EventDividend[];
  recent: EventDividend[];
  failed: boolean;
}> {
  const { fromIso, toIso } = dividendDateRange(400, 400);

  const [universe, prices] = await Promise.all([loadDividendUniverse(), loadPrices()]);

  const results = await Promise.allSettled(
    universe.map(({ secid, name, uid }) =>
      loadDividendsForTicker(secid, name, uid, fromIso, toIso),
    ),
  );

  const failed = results.every((r) => r.status === "rejected");
  const all: EventDividend[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const d of r.value) {
      if (!d.date) continue;
      const price = prices.get(d.secid) ?? null;
      const yieldPct = price && d.value > 0 ? (d.value / price) * 100 : null;
      all.push({ ...d, price, yieldPct });
    }
  }

  const today = todayMsk();
  const upcoming = all
    .filter((d) => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const recent = all
    .filter((d) => d.date < today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);

  return { upcoming, recent, failed };
}

// Фронт-месяц по каждому ASSETCODE: строка с реальной активностью
// (оборот или открытые позиции сегодня) и минимальной датой экспирации.
// Логика повторяет frontContract из app/api/market/route.ts — не
// импортируется оттуда, это внутренняя деталь этого роута.
async function loadExpirations(): Promise<{
  expirations: EventExpiration[];
  failed: boolean;
}> {
  let json: unknown;
  try {
    json = await fetchJson(URL_FORTS_FRONTS, 2, 9000, 3600);
  } catch {
    return { expirations: [], failed: true };
  }

  const secRows = parseIssTable(json, "securities");
  const mdRows = parseIssTable(json, "marketdata");
  const md = new Map<string, Record<string, unknown>>();
  mdRows.forEach((r) => {
    if (typeof r["SECID"] === "string") md.set(r["SECID"], r);
  });

  const byAsset = new Map<string, Record<string, unknown>[]>();
  secRows.forEach((r) => {
    const assetCode = r["ASSETCODE"];
    if (typeof assetCode !== "string") return;
    const m = md.get(String(r["SECID"]));
    const valToday = typeof m?.["VALTODAY"] === "number" ? m["VALTODAY"] : 0;
    const openPos = typeof m?.["OPENPOSITION"] === "number" ? m["OPENPOSITION"] : 0;
    if (valToday <= 0 && openPos <= 0) return;
    if (!byAsset.has(assetCode)) byAsset.set(assetCode, []);
    byAsset.get(assetCode)!.push(r);
  });

  const fronts: EventExpiration[] = [];
  for (const rows of byAsset.values()) {
    const front = rows
      .slice()
      .sort((a, b) =>
        String(a["LASTTRADEDATE"]).localeCompare(String(b["LASTTRADEDATE"])),
      )[0];
    if (!front) continue;
    fronts.push({
      secid: String(front["SECID"] ?? ""),
      shortName: String(front["SHORTNAME"] ?? ""),
      assetCode: String(front["ASSETCODE"] ?? ""),
      name: String(front["SECNAME"] ?? ""),
      lastTradeDate: String(front["LASTTRADEDATE"] ?? ""),
    });
  }

  fronts.sort((a, b) => a.lastTradeDate.localeCompare(b.lastTradeDate));
  return { expirations: fronts.slice(0, 40), failed: false };
}

export async function GET() {
  const [divResult, expResult] = await Promise.all([loadDividends(), loadExpirations()]);

  if (divResult.failed && expResult.failed) {
    return NextResponse.json(
      { error: "Не удалось получить данные" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body: EventsResponse = {
    dividends: { upcoming: divResult.upcoming, recent: divResult.recent },
    expirations: expResult.expirations,
  };

  return NextResponse.json(body);
}
