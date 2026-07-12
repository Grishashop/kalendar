import { NextResponse } from "next/server";

// Дашборд «Российский рынок»: агрегирует котировки из открытых источников
// (Московская биржа ISS + курсы ЦБ РФ через зеркало cbr-xml-daily.ru).
// Все запросы идут server-side, поэтому клиент делает один запрос и обходит CORS.

// Без этого GET статически закэшировал бы первый ответ навсегда — данные рынка
// должны обновляться на каждый запрос.
export const dynamic = "force-dynamic";
// Запас по времени: 6 внешних запросов с ретраями. Без этого дефолтный
// лимит функции (10 c на Hobby) мог бы обрывать медленные ретраи.
export const maxDuration = 30;

// --- Контракт ответа (его же использует клиент) ---

export interface Quote {
  secid: string;
  name: string;
  last: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  unit: string;
}

// Ближайший фьючерсный контракт на индекс (значение — в пунктах индекса).
export interface IndexFuture {
  secid: string; // напр. "MXU6"
  shortName: string; // напр. "MIX-9.26"
  last: number | null;
  changePct: number | null;
}

// Индекс + его ближайший фьючерс (в той же карточке на дашборде).
export interface IndexQuote extends Quote {
  future: IndexFuture | null;
}

export interface MarketResponse {
  indices: IndexQuote[];
  stocks: Quote[];
  commodities: Quote[];
  currencies: Quote[];
  sparklines: { imoex: number[]; rtsi: number[] };
  moexTime: string | null;
  cbrDate: string | null;
}

// --- Константы состава ---

// Топ-10 ликвидных бумаг TQBR. Менять состав — только здесь.
const STOCK_TICKERS = [
  "SBER",
  "GAZP",
  "LKOH",
  "ROSN",
  "NVTK",
  "GMKN",
  "YDEX",
  "T",
  "VTBR",
  "PLZL",
];

const STOCK_NAMES: Record<string, string> = {
  SBER: "Сбербанк",
  GAZP: "Газпром",
  LKOH: "Лукойл",
  ROSN: "Роснефть",
  NVTK: "Новатэк",
  GMKN: "Норникель",
  YDEX: "Яндекс",
  T: "Т-Технологии",
  VTBR: "ВТБ",
  PLZL: "Полюс",
};

// --- Хелперы ---

// Превращает ISS-блок { columns, data } в массив объектов { COLUMN: value }.
function parseIssTable(
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
const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (compatible; LavochkaMarketDashboard/1.0; +https://lavochka.vercel.app)",
  Accept: "application/json, text/javascript, */*",
};

async function fetchJson(url: string, attempts = 3): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(9000),
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

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// last === 0 или отсутствует → сделок не было, показываем null.
function lastOrNull(v: unknown): number | null {
  const n = num(v);
  return n && n !== 0 ? n : null;
}

// --- URL источников ---

const URL_INDICES =
  "https://iss.moex.com/iss/engines/stock/markets/index/securities.json?securities=IMOEX,RTSI&iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,BOARDID,CURRENTVALUE,LASTCHANGEPRC,OPENVALUE,HIGH,LOW,UPDATETIME";

const URL_STOCKS =
  "https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?securities=" +
  STOCK_TICKERS.join(",") +
  "&iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME&marketdata.columns=SECID,LAST,OPEN,LASTTOPREVPRICE,HIGH,LOW,UPDATETIME";

const URL_FORTS =
  "https://iss.moex.com/iss/engines/futures/markets/forts/securities.json?assets=BR,NG,GOLD,MIX,RTS&iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,ASSETCODE,LASTTRADEDATE&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,UPDATETIME";

const URL_CBR = "https://www.cbr-xml-daily.ru/daily_json.js";

const URL_CNY =
  "https://iss.moex.com/iss/engines/currency/markets/selt/boards/CETS/securities.json?securities=CNYRUB_TOM&iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,UPDATETIME";

function candlesUrl(board: string, secid: string, from: string): string {
  return (
    `https://iss.moex.com/iss/engines/stock/markets/index/boards/${board}/securities/${secid}/candles.json` +
    `?interval=10&iss.meta=off&candles.columns=close,begin&from=${from}`
  );
}

// Сегодняшняя дата по МСК (UTC+3) в формате YYYY-MM-DD.
function todayMsk(): string {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

// --- Преобразователи блоков ---

function buildIndices(json: unknown): Quote[] {
  const rows = parseIssTable(json, "marketdata");
  const meta: Record<string, { name: string }> = {
    IMOEX: { name: "Индекс МосБиржи" },
    RTSI: { name: "Индекс РТС" },
  };
  return ["IMOEX", "RTSI"]
    .map((secid) => {
      const candidates = rows.filter((r) => r["SECID"] === secid);
      // Один SECID может прийти с нескольких бордов — берём первую строку с ненулевым CURRENTVALUE.
      const r =
        candidates.find((c) => num(c["CURRENTVALUE"])) ?? candidates[0];
      if (!r) return null;
      return {
        secid,
        name: meta[secid].name,
        last: num(r["CURRENTVALUE"]),
        changePct: num(r["LASTCHANGEPRC"]),
        open: num(r["OPENVALUE"]),
        high: num(r["HIGH"]),
        low: num(r["LOW"]),
        unit: "п.",
      } satisfies Quote;
    })
    .filter((q): q is Quote => q !== null);
}

function buildStocks(json: unknown): Quote[] {
  const secRows = parseIssTable(json, "securities");
  const mdRows = parseIssTable(json, "marketdata");
  const names = new Map<string, string>();
  secRows.forEach((r) => {
    if (typeof r["SECID"] === "string")
      names.set(r["SECID"], String(r["SHORTNAME"] ?? ""));
  });
  const md = new Map<string, Record<string, unknown>>();
  mdRows.forEach((r) => {
    if (typeof r["SECID"] === "string") md.set(r["SECID"], r);
  });
  return STOCK_TICKERS.map((secid) => {
    const r = md.get(secid) ?? {};
    return {
      secid,
      name: STOCK_NAMES[secid] ?? names.get(secid) ?? secid,
      last: lastOrNull(r["LAST"]),
      changePct: num(r["LASTTOPREVPRICE"]),
      open: lastOrNull(r["OPEN"]),
      high: lastOrNull(r["HIGH"]),
      low: lastOrNull(r["LOW"]),
      unit: "₽",
    } satisfies Quote;
  });
}

// Фронт-месяц серии ASSETCODE: строка с LAST > 0 и минимальной датой экспирации.
function frontContract(
  secRows: Record<string, unknown>[],
  md: Map<string, Record<string, unknown>>,
  assetCode: string,
): { r: Record<string, unknown>; m: Record<string, unknown> } | null {
  const series = secRows
    .filter((r) => r["ASSETCODE"] === assetCode)
    .map((r) => ({ r, m: md.get(String(r["SECID"])) }))
    .filter(({ m }) => m && lastOrNull(m["LAST"]) !== null)
    .sort((a, b) =>
      String(a.r["LASTTRADEDATE"]).localeCompare(String(b.r["LASTTRADEDATE"])),
    );
  const front = series[0];
  return front && front.m ? { r: front.r, m: front.m } : null;
}

function buildCommodities(json: unknown): Quote[] {
  const secRows = parseIssTable(json, "securities");
  const mdRows = parseIssTable(json, "marketdata");
  const md = new Map<string, Record<string, unknown>>();
  mdRows.forEach((r) => {
    if (typeof r["SECID"] === "string") md.set(r["SECID"], r);
  });

  const assets: { code: string; name: string; unit: string }[] = [
    { code: "BR", name: "Brent", unit: "$/барр." },
    { code: "GOLD", name: "Золото", unit: "$/унц." },
    { code: "NG", name: "Природный газ", unit: "$/MMBtu" },
  ];

  const out: Quote[] = [];
  for (const { code, name, unit } of assets) {
    const front = frontContract(secRows, md, code);
    if (!front) continue;
    out.push({
      secid: String(front.r["SECID"]),
      name,
      last: lastOrNull(front.m["LAST"]),
      changePct: num(front.m["LASTTOPREVPRICE"]),
      open: null,
      high: null,
      low: null,
      unit,
    });
  }
  return out;
}

// Ближайшие фьючерсы на индексы: MIX → Индекс МосБиржи, RTS → Индекс РТС.
// Контракты котируются в пунктах индекса ×100, поэтому last делим на 100.
function buildIndexFutures(json: unknown): Record<string, IndexFuture> {
  const secRows = parseIssTable(json, "securities");
  const mdRows = parseIssTable(json, "marketdata");
  const md = new Map<string, Record<string, unknown>>();
  mdRows.forEach((r) => {
    if (typeof r["SECID"] === "string") md.set(r["SECID"], r);
  });

  const pairs: { asset: string; index: string }[] = [
    { asset: "MIX", index: "IMOEX" },
    { asset: "RTS", index: "RTSI" },
  ];

  const out: Record<string, IndexFuture> = {};
  for (const { asset, index } of pairs) {
    const front = frontContract(secRows, md, asset);
    if (!front) continue;
    const raw = lastOrNull(front.m["LAST"]);
    out[index] = {
      secid: String(front.r["SECID"]),
      shortName: String(front.r["SHORTNAME"] ?? ""),
      last: raw === null ? null : raw / 100,
      changePct: num(front.m["LASTTOPREVPRICE"]),
    };
  }
  return out;
}

function buildCurrencies(cbrJson: unknown, cnyJson: unknown): Quote[] {
  const out: Quote[] = [];
  const valute = (cbrJson as Record<string, unknown> | null)?.["Valute"] as
    | Record<string, { Value?: number; Previous?: number }>
    | undefined;

  const cbrPair = (
    code: string,
    secid: string,
    name: string,
  ): Quote | null => {
    const v = valute?.[code];
    const value = num(v?.Value);
    const prev = num(v?.Previous);
    if (value === null) return null;
    const changePct =
      prev !== null && prev !== 0 ? ((value - prev) / prev) * 100 : null;
    return {
      secid,
      name,
      last: value,
      changePct,
      open: null,
      high: null,
      low: null,
      unit: "₽",
    };
  };

  const usd = cbrPair("USD", "USD_CBR", "Доллар США (ЦБ)");
  if (usd) out.push(usd);
  const eur = cbrPair("EUR", "EUR_CBR", "Евро (ЦБ)");
  if (eur) out.push(eur);

  // Юань — биржевой CNYRUB_TOM.
  const cnyRows = parseIssTable(cnyJson, "marketdata");
  const cnyRow = cnyRows.find((r) => r["SECID"] === "CNYRUB_TOM");
  const cnyLast = cnyRow ? lastOrNull(cnyRow["LAST"]) : null;
  if (cnyLast !== null) {
    out.push({
      secid: "CNYRUB_TOM",
      name: "Юань (биржа)",
      last: cnyLast,
      changePct: cnyRow ? num(cnyRow["LASTTOPREVPRICE"]) : null,
      open: null,
      high: null,
      low: null,
      unit: "₽",
    });
  } else {
    // Фолбэк на официальный курс ЦБ, если биржевой недоступен.
    const cnyCbr = cbrPair("CNY", "CNY_CBR", "Юань (ЦБ)");
    if (cnyCbr) out.push(cnyCbr);
  }

  return out;
}

function buildSparkline(json: unknown): number[] {
  const rows = parseIssTable(json, "candles");
  return rows
    .map((r) => num(r["close"]))
    .filter((v): v is number => v !== null);
}

// Максимальное UPDATETIME (HH:MM:SS) среди строк, у которых оно есть.
function maxUpdateTime(...quoteJsons: unknown[]): string | null {
  let max: string | null = null;
  for (const json of quoteJsons) {
    const rows = parseIssTable(json, "marketdata");
    for (const r of rows) {
      const t = r["UPDATETIME"];
      if (typeof t === "string" && /^\d{2}:\d{2}:\d{2}$/.test(t)) {
        if (max === null || t > max) max = t;
      }
    }
  }
  return max;
}

export async function GET() {
  const today = todayMsk();

  const [
    indicesR,
    stocksR,
    fortsR,
    cbrR,
    cnyR,
    sparkImoexR,
    sparkRtsiR,
  ] = await Promise.allSettled([
    fetchJson(URL_INDICES),
    fetchJson(URL_STOCKS),
    fetchJson(URL_FORTS),
    fetchJson(URL_CBR),
    fetchJson(URL_CNY),
    fetchJson(candlesUrl("SNDX", "IMOEX", today)),
    fetchJson(candlesUrl("RTSI", "RTSI", today)),
  ]);

  const val = <T,>(r: PromiseSettledResult<T>): T | null =>
    r.status === "fulfilled" ? r.value : null;

  const indicesJson = val(indicesR);
  const stocksJson = val(stocksR);
  const fortsJson = val(fortsR);
  const cbrJson = val(cbrR);
  const cnyJson = val(cnyR);

  // Если не удалось получить вообще ничего существенного — 502.
  if (
    indicesJson === null &&
    stocksJson === null &&
    fortsJson === null &&
    cbrJson === null
  ) {
    return NextResponse.json(
      { error: "Не удалось получить данные" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cbrDate =
    ((cbrJson as Record<string, unknown> | null)?.["Date"] as
      | string
      | undefined) ?? null;

  const indexFutures = fortsJson ? buildIndexFutures(fortsJson) : {};
  const indices: IndexQuote[] = (
    indicesJson ? buildIndices(indicesJson) : []
  ).map((q) => ({ ...q, future: indexFutures[q.secid] ?? null }));

  const body: MarketResponse = {
    indices,
    stocks: stocksJson ? buildStocks(stocksJson) : [],
    commodities: fortsJson ? buildCommodities(fortsJson) : [],
    currencies: buildCurrencies(cbrJson, cnyJson),
    sparklines: {
      imoex: buildSparkline(val(sparkImoexR)),
      rtsi: buildSparkline(val(sparkRtsiR)),
    },
    moexTime: maxUpdateTime(indicesJson, stocksJson),
    cbrDate,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
