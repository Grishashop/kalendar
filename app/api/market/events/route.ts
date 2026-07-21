import { NextResponse } from "next/server";
import { fetchJson, parseIssTable, todayMsk } from "@/lib/moex/iss";
import { SECTOR_GROUPS } from "@/lib/moex/sectors";

// Сводные события рынка для /market/info: ближайшие дивиденды по фиксированной
// вселенной IMOEX-бумаг (SECTOR_GROUPS — bulk-эндпоинта дивидендов у ISS нет)
// и ближайшие по экспирации фронт-контракты FORTS по каждому базовому активу.

export const maxDuration = 30;

export interface EventDividend {
  secid: string;
  name: string;
  date: string;
  value: number;
  currency: string;
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

const DIVIDEND_TICKERS = SECTOR_GROUPS.flatMap((g) => g.items);

const URL_FORTS_FRONTS =
  "https://iss.moex.com/iss/engines/futures/markets/forts/securities.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,SECNAME,ASSETCODE,LASTTRADEDATE&marketdata.columns=SECID,VALTODAY,OPENPOSITION";

async function loadDividends(): Promise<{
  upcoming: EventDividend[];
  recent: EventDividend[];
  failed: boolean;
}> {
  const results = await Promise.allSettled(
    DIVIDEND_TICKERS.map(async ({ secid, name }) => {
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
    }),
  );

  const failed = results.every((r) => r.status === "rejected");
  const all: EventDividend[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value.filter((d) => d.date));
  }

  const today = todayMsk();
  const upcoming = all
    .filter((d) => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const recent = all
    .filter((d) => d.date < today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

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
