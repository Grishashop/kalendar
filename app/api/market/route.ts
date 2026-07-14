import { NextResponse } from "next/server";

// Дашборд «Российский рынок»: агрегирует котировки из открытых источников
// (Московская биржа ISS + курсы ЦБ РФ через зеркало cbr-xml-daily.ru).
// Все запросы идут server-side, поэтому клиент делает один запрос и обходит CORS.

// Короткий TTL вместо force-dynamic: большинство визитов отдаются из кэша
// Data Cache без похода на MOEX/ЦБ, а данные всё равно обновляются раз в 8с —
// этого достаточно для рынка, который не тикает быстрее пары секунд.
export const revalidate = 8;
// Регион для Node.js serverless-функций на Vercel задаётся только через
// vercel.json ("regions"), route-level preferredRegion — no-op без runtime="edge".
// Запас по времени: 9 внешних запросов параллельно, с ретраями. Без этого
// дефолтный лимит функции мог бы обрывать медленные ретраи.
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
  contract?: string; // краткое имя фьючерсного контракта (для сырья — сама котировка это фьючерс)
  future?: FutureInfo | null; // ближайший фьючерс рядом со спот-значением (валюты)
}

// Ближайший фьючерс; last уже приведён к единицам базового актива.
export interface FutureInfo {
  secid: string; // напр. "MXU6", "SiU6"
  shortName: string; // напр. "MIX-9.26", "Si-9.26"
  last: number | null;
  changePct: number | null;
}

// Индекс + его ближайший фьючерс (в той же карточке на дашборде).
export interface IndexQuote extends Quote {
  future: FutureInfo | null;
}

export interface MarketResponse {
  indices: IndexQuote[];
  stocks: Quote[];
  commodities: Quote[];
  currencies: Quote[];
  // Топ-20 по обороту (VALTODAY, ₽) за сессию — для «Расширенного вида».
  topStocksByVolume: Quote[];
  topFuturesByVolume: Quote[];
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
        // cache:"no-store" тут держал бы весь route handler динамическим
        // (Next.js правило: один no-store фетч — вся ветка не кэшируется),
        // что сводило на нет export const revalidate выше.
        next: { revalidate: 8 },
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

// Цена фьючерса: последняя сделка, иначе расчётная цена (в выходные сделок нет).
function futuresPrice(m: Record<string, unknown>): number | null {
  return lastOrNull(m["LAST"]) ?? lastOrNull(m["SETTLEPRICE"]);
}

// Изменение фьючерса: к пред. закрытию, иначе к пред. расчётной цене.
function futuresChange(m: Record<string, unknown>): number | null {
  return num(m["LASTTOPREVPRICE"]) ?? num(m["SETTLETOPREVSETTLEPRC"]);
}

// --- URL источников ---

const URL_INDICES =
  "https://iss.moex.com/iss/engines/stock/markets/index/securities.json?securities=IMOEX,RTSI&iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,BOARDID,CURRENTVALUE,LASTCHANGEPRC,OPENVALUE,HIGH,LOW,UPDATETIME";

const URL_STOCKS =
  "https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?securities=" +
  STOCK_TICKERS.join(",") +
  "&iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME&marketdata.columns=SECID,LAST,OPEN,LASTTOPREVPRICE,HIGH,LOW,UPDATETIME";

const URL_FORTS =
  "https://iss.moex.com/iss/engines/futures/markets/forts/securities.json?assets=BR,NG,GOLD,MIX,RTS,Si,Eu,CNY&iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,ASSETCODE,LASTTRADEDATE&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,SETTLEPRICE,SETTLETOPREVSETTLEPRC,UPDATETIME";

// Всё TQBR-табло (без фильтра по тикерам) — источник для «топ-20 по обороту».
const URL_STOCKS_ALL =
  "https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME&marketdata.columns=SECID,LAST,OPEN,LASTTOPREVPRICE,HIGH,LOW,UPDATETIME,VALTODAY";

// Все контракты FORTS (без фильтра по assets) — источник для «топ-20 фьючерсов по обороту».
const URL_FORTS_ALL =
  "https://iss.moex.com/iss/engines/futures/markets/forts/securities.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,ASSETCODE,LASTTRADEDATE&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,SETTLEPRICE,SETTLETOPREVSETTLEPRC,UPDATETIME,VALTODAY";

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

// Топ-20 акций TQBR по обороту (VALTODAY, ₽) за сессию — весь список бумаг,
// а не только фиксированные "голубые фишки" из STOCK_TICKERS.
function buildTopStocks(json: unknown): Quote[] {
  const names = new Map<string, string>();
  parseIssTable(json, "securities").forEach((r) => {
    if (typeof r["SECID"] === "string")
      names.set(r["SECID"], String(r["SHORTNAME"] ?? ""));
  });
  return parseIssTable(json, "marketdata")
    .filter((r) => typeof r["SECID"] === "string" && lastOrNull(r["LAST"]) !== null)
    .map((r) => {
      const secid = String(r["SECID"]);
      return {
        quote: {
          secid,
          name: STOCK_NAMES[secid] ?? names.get(secid) ?? secid,
          last: lastOrNull(r["LAST"]),
          changePct: num(r["LASTTOPREVPRICE"]),
          open: lastOrNull(r["OPEN"]),
          high: lastOrNull(r["HIGH"]),
          low: lastOrNull(r["LOW"]),
          unit: "₽",
        } satisfies Quote,
        volume: num(r["VALTODAY"]) ?? 0,
      };
    })
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 20)
    .map(({ quote }) => quote);
}

// Фронт-месяц серии ASSETCODE: строка с валидной ценой и минимальной экспирацией.
function frontContract(
  secRows: Record<string, unknown>[],
  md: Map<string, Record<string, unknown>>,
  assetCode: string,
): { r: Record<string, unknown>; m: Record<string, unknown> } | null {
  const series = secRows
    .filter((r) => r["ASSETCODE"] === assetCode)
    .map((r) => ({ r, m: md.get(String(r["SECID"])) }))
    .filter(({ m }) => m && futuresPrice(m) !== null)
    .sort((a, b) =>
      String(a.r["LASTTRADEDATE"]).localeCompare(String(b.r["LASTTRADEDATE"])),
    );
  const front = series[0];
  return front && front.m ? { r: front.r, m: front.m } : null;
}

// Человекочитаемые названия самых ликвидных базовых активов FORTS; для
// остальных (акции, менее ходовые товары) используем сам код актива.
const FUTURES_ASSET_NAMES: Record<string, string> = {
  BR: "Brent",
  GOLD: "Золото",
  NG: "Природный газ",
  MIX: "Индекс МосБиржи",
  RTS: "Индекс РТС",
  Si: "Доллар США",
  Eu: "Евро",
  CNY: "Юань",
};

// Топ-20 ближайших по экспирации фьючерсных контрактов FORTS по обороту
// (VALTODAY, ₽): по каждому базовому активу берём фронт-месяц, затем сортируем
// весь набор фронтов по обороту. Дальние месяцы почти всегда неликвидны, так
// что "ближайшие" и "самые торгуемые" на практике совпадают.
function buildTopFutures(json: unknown): Quote[] {
  const secRows = parseIssTable(json, "securities");
  const md = new Map<string, Record<string, unknown>>();
  parseIssTable(json, "marketdata").forEach((r) => {
    if (typeof r["SECID"] === "string") md.set(r["SECID"], r);
  });
  const assetCodes = new Set(
    secRows
      .map((r) => (typeof r["ASSETCODE"] === "string" ? r["ASSETCODE"] : ""))
      .filter(Boolean),
  );
  const fronts: { r: Record<string, unknown>; m: Record<string, unknown>; volume: number }[] =
    [];
  for (const asset of assetCodes) {
    const front = frontContract(secRows, md, asset);
    if (!front) continue;
    const volume = num(front.m["VALTODAY"]) ?? 0;
    if (volume <= 0) continue;
    fronts.push({ ...front, volume });
  }
  return fronts
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 20)
    .map(({ r, m }) => {
      const asset = String(r["ASSETCODE"] ?? "");
      return {
        secid: String(r["SECID"]),
        name: FUTURES_ASSET_NAMES[asset] ?? asset,
        last: futuresPrice(m),
        changePct: futuresChange(m),
        open: null,
        high: null,
        low: null,
        unit: "",
        contract: String(r["SHORTNAME"] ?? ""),
      } satisfies Quote;
    });
}

function buildCommodities(json: unknown): Quote[] {
  const secRows = parseIssTable(json, "securities");
  const md = new Map<string, Record<string, unknown>>();
  parseIssTable(json, "marketdata").forEach((r) => {
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
    // Котировка сырья на MOEX — это и есть ближайший фьючерс; подписываем контракт.
    out.push({
      secid: String(front.r["SECID"]),
      name,
      last: futuresPrice(front.m),
      changePct: futuresChange(front.m),
      open: null,
      high: null,
      low: null,
      unit,
      contract: String(front.r["SHORTNAME"] ?? ""),
    });
  }
  return out;
}

// Ближайшие фьючерсы по списку {asset → key, scale}. scale приводит цену
// контракта к единицам базового актива: индексы ×100, Si/Eu ×1000, CNY ×1.
function buildFuturesMap(
  json: unknown,
  pairs: { asset: string; key: string; scale: number }[],
): Record<string, FutureInfo> {
  const secRows = parseIssTable(json, "securities");
  const md = new Map<string, Record<string, unknown>>();
  parseIssTable(json, "marketdata").forEach((r) => {
    if (typeof r["SECID"] === "string") md.set(r["SECID"], r);
  });
  const out: Record<string, FutureInfo> = {};
  for (const { asset, key, scale } of pairs) {
    const front = frontContract(secRows, md, asset);
    if (!front) continue;
    const raw = futuresPrice(front.m);
    out[key] = {
      secid: String(front.r["SECID"]),
      shortName: String(front.r["SHORTNAME"] ?? ""),
      last: raw === null ? null : raw / scale,
      changePct: futuresChange(front.m),
    };
  }
  return out;
}

// MIX → Индекс МосБиржи, RTS → Индекс РТС (котируются в пунктах ×100).
const INDEX_FUTURES = [
  { asset: "MIX", key: "IMOEX", scale: 100 },
  { asset: "RTS", key: "RTSI", scale: 100 },
];

// Si → доллар, Eu → евро (цена ×1000), CNY → юань (цена уже в рублях, ×1).
const CURRENCY_FUTURES = [
  { asset: "Si", key: "USD", scale: 1000 },
  { asset: "Eu", key: "EUR", scale: 1000 },
  { asset: "CNY", key: "CNY", scale: 1 },
];

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
    topStocksR,
    topFuturesR,
  ] = await Promise.allSettled([
    fetchJson(URL_INDICES),
    fetchJson(URL_STOCKS),
    fetchJson(URL_FORTS),
    fetchJson(URL_CBR),
    fetchJson(URL_CNY),
    fetchJson(candlesUrl("SNDX", "IMOEX", today)),
    fetchJson(candlesUrl("RTSI", "RTSI", today)),
    fetchJson(URL_STOCKS_ALL),
    fetchJson(URL_FORTS_ALL),
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

  const indexFutures = fortsJson ? buildFuturesMap(fortsJson, INDEX_FUTURES) : {};
  const indices: IndexQuote[] = (
    indicesJson ? buildIndices(indicesJson) : []
  ).map((q) => ({ ...q, future: indexFutures[q.secid] ?? null }));

  const currencyFutures = fortsJson
    ? buildFuturesMap(fortsJson, CURRENCY_FUTURES)
    : {};
  const currencies: Quote[] = buildCurrencies(cbrJson, cnyJson).map((q) => {
    const code = q.secid.startsWith("USD")
      ? "USD"
      : q.secid.startsWith("EUR")
        ? "EUR"
        : q.secid.startsWith("CNY")
          ? "CNY"
          : null;
    return { ...q, future: code ? (currencyFutures[code] ?? null) : null };
  });

  const body: MarketResponse = {
    indices,
    stocks: stocksJson ? buildStocks(stocksJson) : [],
    commodities: fortsJson ? buildCommodities(fortsJson) : [],
    currencies,
    topStocksByVolume: val(topStocksR) ? buildTopStocks(val(topStocksR)) : [],
    topFuturesByVolume: val(topFuturesR) ? buildTopFutures(val(topFuturesR)) : [],
    sparklines: {
      imoex: buildSparkline(val(sparkImoexR)),
      rtsi: buildSparkline(val(sparkRtsiR)),
    },
    moexTime: maxUpdateTime(indicesJson, stocksJson),
    cbrDate,
  };

  // Без явного Cache-Control Next применяет кэш из export const revalidate
  // выше; жёсткий no-store тут (как раньше при force-dynamic) сводил бы его
  // на нет для КАЖДОГО успешного ответа.
  return NextResponse.json(body);
}
