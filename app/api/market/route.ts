import { NextResponse } from "next/server";

// Дашборд «Российский рынок»: агрегирует котировки из открытых источников
// (Московская биржа ISS + курсы ЦБ РФ через зеркало cbr-xml-daily.ru).
// Все запросы идут server-side, поэтому клиент делает один запрос и обходит CORS.

// force-dynamic вместо revalidate: с revalidate Next.js кеширует ОТВЕТ
// самого route handler'а (ISR/Full Route Cache) со stale-while-revalidate —
// после 8с первый запрос отдаёт старые данные и в фоне триггерит
// перегенерацию, а свежие данные видит только СЛЕДУЮЩИЙ запрос. Для
// «нажал обновить — должно быть свежее» это не годится (воспроизведено:
// после `next build && next start` заголовок `x-nextjs-cache: STALE`
// держался несколько запросов подряд, пока MOEX отвечал медленно).
// force-dynamic отключает только этот слой (Full Route Cache); Data Cache
// у fetch() внутри GET() (next.revalidate: 8 в fetchJson) продолжает
// работать как раньше — большинство визитов всё ещё не ходят на MOEX/ЦБ,
// но сам route handler выполняется на каждый запрос, поэтому обновление
// в браузере детерминированно отдаёт актуальные (не более чем 8с) данные.
export const dynamic = "force-dynamic";
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

async function fetchJson(
  url: string,
  attempts = 3,
  timeoutMs = 9000,
): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        // no-store тут отключил бы Data Cache для этого fetch — с
        // export const dynamic = "force-dynamic" на сам route handler это
        // не влияет, но next.revalidate всё равно даёт дедупликацию
        // одинаковых URL в пределах 8с без похода на MOEX/ЦБ.
        next: { revalidate: 8 },
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
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

// IMOEX2 = тот же индекс МосБиржи, но считается по всем сессиям
// (07:00–23:50 МСК), а не только по основной (~10:00–18:50), как IMOEX.
const URL_INDICES =
  "https://iss.moex.com/iss/engines/stock/markets/index/securities.json?securities=IMOEX2,RTSI&iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,BOARDID,CURRENTVALUE,LASTCHANGEPRC,OPENVALUE,HIGH,LOW,UPDATETIME";

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

// Текущее время по МСК (UTC+3) в формате HH:MM:SS.
function nowMsk(): string {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return now.toISOString().slice(11, 19);
}

// --- Коррекция % изменения для сессий выходного дня ---
//
// С 2024 года MOEX проводит торги по субботам/воскресеньям для акций TQBR,
// индекса IMOEX и части FORTS-фьючерсов. Но официальное "предыдущее
// закрытие" (PREVPRICE у бумаг — источник LASTTOPREVPRICE/LASTCHANGEPRC)
// в выходные не обновляется: расчётный торговый день у биржи закрывается
// только в понедельник. Поэтому в выходные % изменения из ISS посчитан от
// закрытия ПЯТНИЦЫ, хотя в субботу/воскресенье уже прошли реальные сделки
// (проверено на живых данных: PREVDATE у SBER в воскресенье оставался
// пятничным при полноценной субботней сессии).
//
// Пересчитываем сами: берём close последнего часового бара строго до
// сегодняшней даты (МСК) — для акций/IMOEX это совпадает с официальным
// закрытием субботы, а для RTSI/FORTS/биржевого юаня (у них своей дневной
// свечи в выходные не бывает) это лучшее доступное приближение. Если
// подходящего бара нет (нет сделок с пятницы) — % изменения не трогаем.

interface CandleSpec {
  engine: string;
  market: string;
  board: string;
}

const TQBR_SPEC: CandleSpec = { engine: "stock", market: "shares", board: "TQBR" };
const FORTS_SPEC: CandleSpec = { engine: "futures", market: "forts", board: "RFUD" };
const CETS_SPEC: CandleSpec = { engine: "currency", market: "selt", board: "CETS" };
const INDEX_SPEC: Record<string, CandleSpec> = {
  IMOEX2: { engine: "stock", market: "index", board: "SNDX" },
  RTSI: { engine: "stock", market: "index", board: "RTSI" },
};

// close последнего бара строго до `today` (лексикографическое сравнение
// ISO-дат в "begin" работает без парсинга).
function lastCloseBefore(
  rows: Record<string, unknown>[],
  today: string,
): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const begin = rows[i]["begin"];
    if (typeof begin === "string" && begin.slice(0, 10) < today) {
      return num(rows[i]["close"]);
    }
  }
  return null;
}

// Раньше все ~50-70 инструментов запускались одним Promise.allSettled
// сразу — сами эти 50-70 одновременных соединений на iss.moex.com (поверх
// первой волны из 9 параллельных запросов чуть выше в GET()) и оказались
// причиной массовых ConnectTimeoutError, воспроизведённых вживую при
// повторных нагрузочных прогонах: после них IMOEX периодически откатывался
// на исходное значение MOEX (снова от пятницы) — не из-за логики
// пересчёта, а потому что сам запрос свечи для него не успевал выполниться
// без единой попытки повтора. Поэтому: короткий таймаут на попытку (не
// ждём долго — это необязательное косметическое улучшение, а не основные
// данные), пул из CANDLE_CONCURRENCY одновременных запросов вместо залпа,
// и общий бюджет времени CANDLE_BUDGET_MS — то, что не успело, остаётся
// с исходным значением MOEX, а не задерживает и не роняет ответ.
async function weekendPrevClose(
  spec: CandleSpec,
  secid: string,
  today: string,
  from: string,
): Promise<number | null> {
  try {
    const url =
      `https://iss.moex.com/iss/engines/${spec.engine}/markets/${spec.market}/boards/${spec.board}` +
      `/securities/${encodeURIComponent(secid)}/candles.json` +
      `?interval=60&iss.meta=off&candles.columns=close,begin&from=${from}`;
    const json = await fetchJson(url, 1, 4000);
    return lastCloseBefore(parseIssTable(json, "candles"), today);
  } catch {
    return null;
  }
}

const CANDLE_CONCURRENCY = 10;
const CANDLE_BUDGET_MS = 10000;

// Пул из `limit` воркеров разбирает `jobs` по очереди, пока не кончится
// список или не истечёт общий бюджет времени. IMOEX/RTSI кладём в начало
// jobs (см. ниже) — они самые заметные на дашборде и самые дешёвые (2 из
// 50-70), поэтому должны успеть даже если бюджет исчерпается на хвосте
// списка (акции топ-20 по обороту, дальние фьючерсы).
async function weekendPrevCloseBatch(
  jobs: { secid: string; spec: CandleSpec }[],
  today: string,
  from: string,
): Promise<Map<string, number>> {
  const prevClose = new Map<string, number>();
  const deadline = Date.now() + CANDLE_BUDGET_MS;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < jobs.length && Date.now() < deadline) {
      const job = jobs[next++];
      const v = await weekendPrevClose(job.spec, job.secid, today, from);
      if (v !== null) prevClose.set(job.secid, v);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CANDLE_CONCURRENCY, jobs.length) }, worker),
  );
  return prevClose;
}

// Пересчитывает changePct у всех котировок в body от цены строго до
// сегодня (см. комментарий выше). Мутирует body на месте. fortsAllJson —
// сырой ответ URL_FORTS_ALL: источник нескейленных цен для embedded
// FutureInfo (у них last уже поделён на scale, но % от этого не зависит —
// делим одинаково масштабированные last/prevClose).
async function applyWeekendCorrection(
  body: MarketResponse,
  fortsAllJson: unknown,
): Promise<void> {
  const today = todayMsk();
  const fromDate = new Date(Date.now() + 3 * 60 * 60 * 1000);
  fromDate.setUTCDate(fromDate.getUTCDate() - 7);
  const from = fromDate.toISOString().slice(0, 10);

  const stockSecids = new Set<string>([
    ...STOCK_TICKERS,
    ...body.topStocksByVolume.map((q) => q.secid),
  ]);
  const futuresSecids = new Set<string>([
    ...body.commodities.map((q) => q.secid),
    ...body.topFuturesByVolume.map((q) => q.secid),
    ...body.indices.map((q) => q.future?.secid).filter((s): s is string => !!s),
    ...body.currencies.map((q) => q.future?.secid).filter((s): s is string => !!s),
  ]);
  const indexSecids = body.indices
    .map((q) => (q.secid === "IMOEX" ? "IMOEX2" : q.secid))
    .filter((s) => s in INDEX_SPEC);
  const cnySecids = body.currencies.some((q) => q.secid === "CNYRUB_TOM")
    ? ["CNYRUB_TOM"]
    : [];

  const jobs: { secid: string; spec: CandleSpec }[] = [
    ...indexSecids.map((secid) => ({ secid, spec: INDEX_SPEC[secid] })),
    ...[...stockSecids].map((secid) => ({ secid, spec: TQBR_SPEC })),
    ...cnySecids.map((secid) => ({ secid, spec: CETS_SPEC })),
    ...[...futuresSecids].map((secid) => ({ secid, spec: FORTS_SPEC })),
  ];

  const prevClose = await weekendPrevCloseBatch(jobs, today, from);

  // Нескейленный текущий last для фьючерсов — из ALL-фьючерсов JSON,
  // покрывает любой контракт вплоть до попавших в топ-20 по обороту.
  const rawFuturesLast = new Map<string, number>();
  parseIssTable(fortsAllJson, "marketdata").forEach((r) => {
    if (typeof r["SECID"] === "string") {
      const v = futuresPrice(r);
      if (v !== null) rawFuturesLast.set(r["SECID"], v);
    }
  });

  const applyPct = (
    target: { changePct: number | null },
    secid: string,
    rawLast: number | null,
  ): void => {
    const prev = prevClose.get(secid);
    if (prev === undefined || prev === 0 || rawLast === null) return;
    target.changePct = ((rawLast - prev) / prev) * 100;
  };

  body.stocks.forEach((q) => applyPct(q, q.secid, q.last));
  body.topStocksByVolume.forEach((q) => applyPct(q, q.secid, q.last));
  body.commodities.forEach((q) => applyPct(q, q.secid, q.last));
  body.topFuturesByVolume.forEach((q) => applyPct(q, q.secid, q.last));
  body.indices.forEach((q) => {
    applyPct(q, q.secid === "IMOEX" ? "IMOEX2" : q.secid, q.last);
    if (q.future) {
      applyPct(q.future, q.future.secid, rawFuturesLast.get(q.future.secid) ?? null);
    }
  });
  body.currencies.forEach((q) => {
    applyPct(q, q.secid, q.last);
    if (q.future) {
      applyPct(q.future, q.future.secid, rawFuturesLast.get(q.future.secid) ?? null);
    }
  });
}

// --- Преобразователи блоков ---

function buildIndices(json: unknown): Quote[] {
  const rows = parseIssTable(json, "marketdata");
  // secid — внутренний идентификатор для клиента/сопоставления с фьючерсом;
  // source — реальный SECID в ответе ISS. IMOEX2 приходит под своим кодом,
  // но остаётся тем же индексом МосБиржи, поэтому наружу отдаём как "IMOEX".
  const meta: Record<string, { source: string; name: string }> = {
    IMOEX: { source: "IMOEX2", name: "Индекс МосБиржи" },
    RTSI: { source: "RTSI", name: "Индекс РТС" },
  };
  return ["IMOEX", "RTSI"]
    .map((secid) => {
      const source = meta[secid].source;
      const candidates = rows.filter((r) => r["SECID"] === source);
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
// UPDATETIME — время суток без даты и обновляется только по факту сделки
// в конкретной бумаге. Индекс (CURRENTVALUE) пересчитывается почти
// непрерывно всю сессию, а неликвидная бумага может не наторговать ни
// одной сделки с прошлого дня — тогда её UPDATETIME так и останется
// вчерашним ("19:00:00" — закрытие прошлой сессии), пока сегодня не
// пройдёт первая сделка. Голый лексикографический max("19:00:00",
// "09:38:12") = "19:00:00": вчерашний остаток "побеждал" свежий тик
// индекса только потому, что "19" > "09" как строка, без даты для
// сравнения. Отбрасываем UPDATETIME позже текущего момента по МСК:
// сегодня такое время ещё не наступило, значит это остаток прошлого дня.
function maxUpdateTime(...quoteJsons: unknown[]): string | null {
  const now = nowMsk();
  let max: string | null = null;
  for (const json of quoteJsons) {
    const rows = parseIssTable(json, "marketdata");
    for (const r of rows) {
      const t = r["UPDATETIME"];
      if (
        typeof t === "string" &&
        /^\d{2}:\d{2}:\d{2}$/.test(t) &&
        t <= now &&
        (max === null || t > max)
      ) {
        max = t;
      }
    }
  }
  return max;
}

export async function GET() {
  const startedAt = Date.now();
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
    fetchJson(candlesUrl("SNDX", "IMOEX2", today)),
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

  // Только по выходным (МСК) — на буднях PREVDATE у MOEX и так корректен.
  // Плюс защита от переполнения maxDuration: если первая волна запросов
  // уже съела больше COOL_TIME_MS — MOEX сегодня медленный/троттлит, и
  // вторая волна (коррекция) рискует не уложиться в лимит функции и
  // уронить ВЕСЬ ответ вместо того, чтобы просто оставить часть котировок
  // с исходным (не всегда точным для выходных) значением MOEX. Лучше
  // отдать то, что уже есть, чем ничего.
  const mskWeekday = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCDay();
  const COOL_TIME_MS = 12000;
  if ((mskWeekday === 0 || mskWeekday === 6) && Date.now() - startedAt < COOL_TIME_MS) {
    await applyWeekendCorrection(body, val(topFuturesR));
  }

  // dynamic = "force-dynamic" выше уже не даёт Next.js кэшировать сам
  // ответ route handler'а — отдельный Cache-Control тут не нужен.
  return NextResponse.json(body);
}
