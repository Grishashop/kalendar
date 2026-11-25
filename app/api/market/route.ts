import { unstable_cache } from "next/cache";
import { restoreMissing } from "@/lib/moex/snapshot";
import { getCache } from "@vercel/functions";
import { lastCloseInDay, previousMoscowDay } from "@/lib/moex/calendar";
import { NextResponse } from "next/server";
import { fetchJson, lastOrNull, num, parseIssTable, todayMsk } from "@/lib/moex/iss";
import { mergeQuoteRows, validPrice, type ProviderQuote } from "@/lib/moex/quote-priority";
import { hourlyCloses, getMarketInstruments, getTBankPrices, TICKER_TO_TBANK_UID } from "@/lib/tbank/invest";
import { alorFetch, getQuotes as getAlorQuotes } from "@/lib/ticker/alor";
import { SECTOR_GROUPS } from "@/lib/moex/sectors";

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
export const maxDuration = 60;

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
  source?: string;
  observedAt?: string;
  receivedAt?: string;
  cached?: boolean;
  contract?: string; // краткое имя фьючерсного контракта (для сырья — сама котировка это фьючерс)
  future?: FutureInfo | null; // ближайший фьючерс рядом со спот-значением (валюты)
  // Официальный курс ЦБ РФ — заполнено только когда основное значение
  // котировки биржевое (USD/EUR/CNY): биржевой курс динамичнее и стоит
  // первым, курс ЦБ — вторичный ориентир рядом с ним. Если биржевого курса
  // нет (площадка закрыта — TOM торгуется только 10:00-19:00 МСК), само
  // основное значение уже и есть курс ЦБ, дублировать тут незачем.
  cbr?: { value: number; changePct: number | null } | null;
  // Заполнено, только если конкретно ЭТА котировка реально не обновлялась
  // прямо сейчас (устарела относительно самого свежего инструмента в той
  // же группе) — время последнего реального обновления, "DD.MM HH:MM"
  // по МСК. Пример: РТС не считается в утреннюю и часть вечерней сессии
  // (нет курса USD/RUB), а IMOEX тикает непрерывно — без этого поля
  // карточка РТС молча показывала бы вчерашние %, выглядящие как текущие.
  staleSince?: string | null;
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

// Отрасль + её бумаги (фиксированный список ~40 самых весомых по индексу
// IMOEX эмитентов) — для вида «По отраслям».
export interface SectorGroup {
  sector: string;
  quotes: Quote[];
}

export interface MarketResponse {
  calendarDay?: string;
  rankingTimes?: Record<string, string>;
  indices: IndexQuote[];
  stocks: Quote[];
  commodities: Quote[];
  currencies: Quote[];
  // Топ-20 по обороту (VALTODAY, ₽) за сессию — для «Расширенного вида».
  topStocksByVolume: Quote[];
  topFuturesByVolume: Quote[];
  // То же самое разбито по отраслям (см. SECTOR_GROUPS) — для «По отраслям».
  sectorStocks: SectorGroup[];
  sparklines: { imoex: number[]; rtsi: number[] };
  moexTime: string | null;
  cbrDate: string | null;
  // Есть котировки, для которых сработал резервный источник Алор.
  alorUsed: boolean;
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

async function fetchAlorQuotes(symbols: string[]): Promise<Map<string, ProviderQuote>> {
  const quotes = new Map<string, ProviderQuote>();
  const requests = [];
  for (let offset = 0; offset < symbols.length; offset += 50) {
    const batch = symbols.slice(offset, offset + 50).map((symbol) => `MOEX:${symbol}`);
    requests.push(getAlorQuotes(batch.join(","), AbortSignal.timeout(4500)));
  }
  for (const result of await Promise.allSettled(requests)) {
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) continue;
    for (const row of result.value) {
      if (typeof row?.symbol !== "string") continue;
      const last = lastOrNull(row.last_price);
      if (last === null) continue;
      quotes.set(row.symbol, {
        last,
        changePct: num(row.change_percent),
        open: lastOrNull(row.open_price),
        high: lastOrNull(row.high_price),
        low: lastOrNull(row.low_price),
      });
    }
  }
  return quotes;
}

function issTable(rows: Record<string, unknown>[]) {
  const columns = [...new Set(rows.flatMap(Object.keys))];
  return { columns, data: rows.map((row) => columns.map((column) => row[column] ?? null)) };
}

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
  "https://iss.moex.com/iss/engines/stock/markets/index/securities.json?securities=IMOEX2,RTSI&iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,BOARDID,CURRENTVALUE,LASTCHANGEPRC,OPENVALUE,HIGH,LOW,UPDATETIME,SYSTIME";

const URL_STOCKS =
  "https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?securities=" +
  STOCK_TICKERS.join(",") +
  "&iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,PREVDATE&marketdata.columns=SECID,LAST,OPEN,LASTTOPREVPRICE,HIGH,LOW,UPDATETIME";

const URL_FORTS =
  "https://iss.moex.com/iss/engines/futures/markets/forts/securities.json?assets=BR,NG,GOLD,MIX,RTS,Si,Eu,CNY&iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,ASSETCODE,LASTTRADEDATE&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,SETTLEPRICE,SETTLETOPREVSETTLEPRC,UPDATETIME";

// Всё TQBR-табло (без фильтра по тикерам) — источник для «топ-20 по обороту».
const URL_STOCKS_ALL =
  "https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME&marketdata.columns=SECID,LAST,OPEN,LASTTOPREVPRICE,HIGH,LOW,UPDATETIME,VALTODAY";

// Все контракты FORTS (без фильтра по assets) — источник для «топ-20 фьючерсов по обороту».
const URL_FORTS_ALL =
  "https://iss.moex.com/iss/engines/futures/markets/forts/securities.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,ASSETCODE,LASTTRADEDATE&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,SETTLEPRICE,SETTLETOPREVSETTLEPRC,UPDATETIME,VALTODAY";

const URL_CBR = "https://www.cbr-xml-daily.ru/daily_json.js";

const URL_FX_TOM =
  "https://iss.moex.com/iss/engines/currency/markets/selt/boards/CETS/securities.json?securities=USD000UTSTOM,EUR_RUB__TOM,CNYRUB_TOM&iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,UPDATETIME";

function candlesUrl(board: string, secid: string, from: string): string {
  return (
    `https://iss.moex.com/iss/engines/stock/markets/index/boards/${board}/securities/${secid}/candles.json` +
    `?interval=10&iss.meta=off&candles.columns=close,begin&from=${from}`
  );
}

// Текущее время по МСК (UTC+3) в формате HH:MM:SS.
function nowMsk(): string {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return now.toISOString().slice(11, 19);
}

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

const calendarClose = unstable_cache(async (
  spec: CandleSpec, symbol: string, id: string, today: string,
) => {
  const { start, end, day } = previousMoscowDay(today);
  if (id) {
    const rows = await hourlyCloses(id, start, end).catch(() => []);
    const close = lastCloseInDay(rows, start, end);
    if (close !== null) return close;
  }
  const params = new URLSearchParams({exchange: "MOEX", symbol, tf: "3600",
    from: String(start / 1000), to: String(end / 1000 - 1)});
  const alor = await alorFetch("/md/v2/history?" + params, AbortSignal.timeout(2000))
    .catch(() => null) as {history?: {time: number; close: number}[]} | null;
  const close = lastCloseInDay((alor?.history ?? []).map(r => ({time: r.time * 1000, close: r.close})), start, end);
  if (close !== null) return close;
  const url = `https://iss.moex.com/iss/engines/${spec.engine}/markets/${spec.market}/boards/${spec.board}/securities/${encodeURIComponent(symbol)}/candles.json?interval=60&iss.meta=off&candles.columns=begin,close&from=${day}&till=${day}`;
  const rows = parseIssTable(await fetchJson(url, 1, 2500, 86400), "candles");
  const last = lastCloseInDay(rows.map(r => ({
    time: Date.parse(String(r.begin).replace(" ", "T") + "+03:00"), close: Number(r.close),
  })), start, end);
  if (last === null) throw new Error("Нет цены за вчера");
  return last;
}, ["market-calendar-close-v1"], { revalidate: 86400 });

async function applyCalendarChange(
  body: MarketResponse, fortsAllJson: unknown, instruments: Map<string,string>, today: string, deadline: number,
) {
  const stockSecids = new Set<string>([
    ...body.stocks.map(q => q.secid),
    ...body.topStocksByVolume.map((q) => q.secid),
    ...body.sectorStocks.flatMap((g) => g.quotes.map((q) => q.secid)),
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
  const jobs = [
    ...indexSecids.map(secid => ({secid, spec: INDEX_SPEC[secid]})),
    ...body.currencies.filter(q => !q.secid.endsWith("_CBR")).map(q => ({secid: q.secid, spec: CETS_SPEC})),
    ...[...stockSecids].map(secid => ({secid, spec: TQBR_SPEC})),
    ...[...futuresSecids].map(secid => ({secid, spec: FORTS_SPEC})),
  ];
  const prevClose = new Map<string, number>();
  let next = 0;
  async function worker() {
    while (next < jobs.length && Date.now() < deadline) {
      const { secid, spec } = jobs[next++];
      const price = await calendarClose(spec, secid, instruments.get(secid) ?? "", today).catch(() => null);
      if (price !== null) prevClose.set(secid, price);
    }
  }
  await Promise.all(Array.from({length: Math.min(12, jobs.length)}, worker));

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
    if (prev === undefined || rawLast === null) { target.changePct = null; return; }
    target.changePct = ((rawLast - prev) / prev) * 100;
  };

  body.stocks.forEach((q) => applyPct(q, q.secid, q.last));
  body.topStocksByVolume.forEach((q) => applyPct(q, q.secid, q.last));
  body.commodities.forEach((q) => applyPct(q, q.secid, q.last));
  body.topFuturesByVolume.forEach((q) => applyPct(q, q.secid, q.last));
  body.sectorStocks.forEach((g) =>
    g.quotes.forEach((q) => applyPct(q, q.secid, q.last)),
  );
  body.indices.forEach((q) => {
    applyPct(q, q.secid === "IMOEX" ? "IMOEX2" : q.secid, q.last);
    if (q.future) {
      applyPct(q.future, q.future.secid, rawFuturesLast.get(q.future.secid) ?? null);
    }
  });
  body.currencies.forEach((q) => {
    if (!q.secid.endsWith("_CBR")) applyPct(q, q.secid, q.last);
    if (q.future) {
      applyPct(q.future, q.future.secid, rawFuturesLast.get(q.future.secid) ?? null);
    }
  });
}

// --- Преобразователи блоков ---

// SYSTIME/UPDATETIME у MOEX — время по МСК без явной таймзоны в строке.
// "YYYY-MM-DD HH:MM:SS" (МСК) минус 3 часа = UTC epoch мс.
function parseMskDateTime(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, se) - 3 * 60 * 60 * 1000;
}

function formatMskDateTime(epochMs: number): string {
  const d = new Date(epochMs + 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Индексы считаются независимо друг от друга: РТС нужен курс USD/RUB,
// которого нет ни в утреннюю сессию, ни часть вечерней — в эти окна РТС
// молча замирает на цене вчерашнего закрытия, а IMOEX (не нужен курс
// валюты) тикает непрерывно. Раньше карточка РТС в этот момент показывала
// вчерашний % как будто текущий — вводило в заблуждение (живой пример:
// РТС не обновлялся с 19:00 понедельника, хотя IMOEX тикал каждую
// секунду в 07:49 вторника). Эталон "сейчас реально идут торги" — самый
// свежий SYSTIME среди всех индексов в этом же ответе; если конкретный
// индекс отстаёт от него больше STALE_THRESHOLD_MS — помечаем staleSince
// временем его последнего реального обновления вместо тихого показа
// устаревшего %. Порог, а не сравнение календарных дат — отставание
// внутри одного дня (вечерняя сессия) календарной проверкой не поймать.
const STALE_THRESHOLD_MS = 3 * 60 * 1000;

function buildIndices(json: unknown): Quote[] {
  const rows = parseIssTable(json, "marketdata");
  // secid — внутренний идентификатор для клиента/сопоставления с фьючерсом;
  // source — реальный SECID в ответе ISS. IMOEX2 приходит под своим кодом,
  // но остаётся тем же индексом МосБиржи, поэтому наружу отдаём как "IMOEX".
  const meta: Record<string, { source: string; name: string }> = {
    IMOEX: { source: "IMOEX2", name: "Индекс МосБиржи" },
    RTSI: { source: "RTSI", name: "Индекс РТС" },
  };
  const sysTimes = rows
    .map((r) => (typeof r["SYSTIME"] === "string" ? parseMskDateTime(r["SYSTIME"]) : null))
    .filter((t): t is number => t !== null);
  const freshest = sysTimes.length > 0 ? Math.max(...sysTimes) : null;

  return ["IMOEX", "RTSI"]
    .map((secid): Quote | null => {
      const source = meta[secid].source;
      const candidates = rows.filter((r) => r["SECID"] === source);
      // Один SECID может прийти с нескольких бордов — берём первую строку с ненулевым CURRENTVALUE.
      const r =
        candidates.find((c) => num(c["CURRENTVALUE"])) ?? candidates[0];
      if (!r) return null;
      const sysTime =
        typeof r["SYSTIME"] === "string" ? parseMskDateTime(r["SYSTIME"]) : null;
      const staleSince =
        freshest !== null && sysTime !== null && freshest - sysTime > STALE_THRESHOLD_MS
          ? formatMskDateTime(sysTime)
          : null;
      return {
        secid,
        name: meta[secid].name,
        last: num(r["CURRENTVALUE"]),
        changePct: num(r["LASTCHANGEPRC"]),
        open: num(r["OPENVALUE"]),
        high: num(r["HIGH"]),
        low: num(r["LOW"]),
        unit: "п.",
        staleSince,
      };
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
    .filter((r) => typeof r["SECID"] === "string" && lastOrNull(r["LAST"]) !== null && (num(r["VALTODAY"]) ?? 0) > 0)
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

// Строится из того же ALL-борда TQBR, что и топ-20 по обороту (buildTopStocks) —
// отдельного запроса не требует, доступно только при ?scope=full.
function buildSectorStocks(json: unknown): SectorGroup[] {
  const md = new Map<string, Record<string, unknown>>();
  parseIssTable(json, "marketdata").forEach((r) => {
    if (typeof r["SECID"] === "string") md.set(r["SECID"], r);
  });
  return SECTOR_GROUPS.map((group) => ({
    sector: group.sector,
    quotes: group.items
      .map(({ secid, name }): Quote | null => {
        const r = md.get(secid);
        if (!r || lastOrNull(r["LAST"]) === null) return null;
        return {
          secid,
          name,
          last: lastOrNull(r["LAST"]),
          changePct: num(r["LASTTOPREVPRICE"]),
          open: lastOrNull(r["OPEN"]),
          high: lastOrNull(r["HIGH"]),
          low: lastOrNull(r["LOW"]),
          unit: "₽",
        };
      })
      .filter((q): q is Quote => q !== null),
  })).filter((g) => g.quotes.length > 0);
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

function buildCurrencies(cbrJson: unknown, fxTomJson: unknown, today: string): Quote[] {
  const out: Quote[] = [];
  const valute = (cbrJson as Record<string, unknown> | null)?.["Valute"] as
    | Record<string, { Value?: number; Previous?: number }>
    | undefined;

  const cbrRate = (
    code: string,
  ): { value: number; changePct: number | null } | null => {
    const v = valute?.[code];
    const value = num(v?.Value);
    const prev = num(v?.Previous);
    if (value === null) return null;
    const changePct =
      prev !== null && prev !== 0 ? ((value - prev) / prev) * 100 : null;
    const dates = cbrJson as { Date?: string; PreviousDate?: string };
    const yesterday = previousMoscowDay(today).day;
    const date = dates.Date?.slice(0, 10);
    // Официальный курс действует до следующего опубликованного курса.
    return { value, changePct: date && date <= yesterday ? 0 :
      date === today && dates.PreviousDate && dates.PreviousDate.slice(0,10) <= yesterday ? changePct : null };
  };

  const fxTomRows = parseIssTable(fxTomJson, "marketdata");

  // Биржевой курс (TOM) обновляется в реальном времени в течение сессии —
  // выводим его как основное значение карточки. Курс ЦБ (фиксируется раз
  // в день) идёт вторичным ориентиром рядом (Quote.cbr) — см. отрисовку в
  // MiniCard. TOM торгуется только 10:00-19:00 МСК (см. расписание
  // валютного рынка): вне этого окна LAST пуст, и тогда основным значением
  // становится сам курс ЦБ — дублировать его в cbr уже незачем.
  const FX = [
    { tomSecid: "USD000UTSTOM", cbrCode: "USD", cbrSecid: "USD_CBR", exchangeName: "Доллар США (биржа)", cbrName: "Доллар США (ЦБ)" },
    { tomSecid: "EUR_RUB__TOM", cbrCode: "EUR", cbrSecid: "EUR_CBR", exchangeName: "Евро (биржа)", cbrName: "Евро (ЦБ)" },
    { tomSecid: "CNYRUB_TOM", cbrCode: "CNY", cbrSecid: "CNY_CBR", exchangeName: "Юань (биржа)", cbrName: "Юань (ЦБ)" },
  ];

  for (const fx of FX) {
    const row = fxTomRows.find((r) => r["SECID"] === fx.tomSecid);
    const tomLast = row ? lastOrNull(row["LAST"]) : null;
    const cbr = cbrRate(fx.cbrCode);
    if (tomLast !== null) {
      out.push({
        secid: fx.tomSecid,
        name: fx.exchangeName,
        last: tomLast,
        changePct: row ? num(row["LASTTOPREVPRICE"]) : null,
        open: null,
        high: null,
        low: null,
        unit: "₽",
        cbr,
      });
    } else if (cbr) {
      out.push({
        secid: fx.cbrSecid,
        name: fx.cbrName,
        last: cbr.value,
        changePct: cbr.changePct,
        open: null,
        high: null,
        low: null,
        unit: "₽",
      });
    }
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

// Компактный вид дашборда не показывает топ-20 по обороту (акции/фьючерсы) —
// эти два списка тянут отдельные тяжёлые запросы (весь борд TQBR/FORTS
// целиком) и добавляют ~30-40 из ~50-70 job'ов в applyWeekendCorrection
// (топ-20 акций + топ-20 фьючерсов + их коррекция). ?scope=full запрашивает
// клиент только при переключении на расширенный вид — по умолчанию (без
// параметра) отдаём компактный набор, который загружается заметно быстрее.
export async function GET(request: Request) {
  const startedAt = Date.now();
  const today = todayMsk();
  const fullScope = new URL(request.url).searchParams.get("scope") === "full";
  const cache = getCache({namespace: "market-calendar-v1"});
  const cacheKey = fullScope ? "full" : "compact";
  const previousRequest = cache.get(cacheKey).then(async value =>
    value ?? await cache.get(fullScope ? "compact" : "full")).catch(() => null);
  const [
    indicesR,
    stocksR,
    fortsR,
    cbrR,
    fxTomR,
    sparkImoexR,
    sparkRtsiR,
    topStocksR,
    topFuturesR,
    futuresCatalogR,
    imoexCatalogR,
    rtsiCatalogR,
  ] = await Promise.allSettled([
    fetchJson(URL_INDICES, 2, 3000),
    fetchJson(URL_STOCKS, 2, 3000),
    fetchJson(URL_FORTS, 2, 3000),
    fetchJson(URL_CBR, 2, 3000),
    fetchJson(URL_FX_TOM, 2, 3000),
    fetchJson(candlesUrl("SNDX", "IMOEX2", today), 1, 3000),
    fetchJson(candlesUrl("RTSI", "RTSI", today), 1, 3000),
    fullScope ? fetchJson(URL_STOCKS_ALL, 2, 3000) : Promise.resolve(null),
    fullScope ? fetchJson(URL_FORTS_ALL, 2, 3000) : Promise.resolve(null),
    getMarketInstruments("Futures"),
    getMarketInstruments("FindInstrument", "IMOEX2"),
    getMarketInstruments("FindInstrument", "RTSI"),
  ]);

  const val = <T,>(r: PromiseSettledResult<T>): T | null =>
    r.status === "fulfilled" ? r.value : null;

  const cbrJson = val(cbrR);
  const stocksRaw = val(stocksR);
  const topStocksRaw = val(topStocksR);
  const fortsRaw = val(fortsR);
  const topFuturesRaw = val(topFuturesR);

  const previous = await previousRequest as MarketResponse | null;
  const instruments = new Map<string, string>();
  const stockSymbols = new Set(STOCK_TICKERS);
  if (fullScope) {
    for (const q of previous?.topStocksByVolume ?? []) stockSymbols.add(q.secid);
    for (const group of SECTOR_GROUPS) {
      for (const { secid } of group.items) stockSymbols.add(secid);
    }
    for (const row of parseIssTable(topStocksRaw, "securities")) {
      if (typeof row.SECID === "string") stockSymbols.add(row.SECID);
    }
  }
  const stockIds: string[] = [];
  for (const symbol of stockSymbols) {
    const id = TICKER_TO_TBANK_UID[symbol] ?? `${symbol}_TQBR`;
    instruments.set(symbol, id);
    stockIds.push(id);
  }

  const fxSymbols = ["USD000UTSTOM", "EUR_RUB__TOM", "CNYRUB_TOM"];
  for (const symbol of fxSymbols) instruments.set(symbol, `${symbol}_CETS`);
  const indexSymbols = ["IMOEX2", "RTSI"];
  for (const [symbol, catalog] of [
    ["IMOEX2", val(imoexCatalogR)],
    ["RTSI", val(rtsiCatalogR)],
  ] as const) {
    const instrument = catalog?.find((row) => row.ticker === symbol && row.classCode === "INDEX");
    instruments.set(symbol, instrument?.uid ?? `${symbol}_INDEX`);
  }

  // Состав Топ-20 определяется оборотом ISS. Котировки запрашиваем
  // только для отобранных контрактов и серий, видимых в обзоре.
  const rankedFutures = new Set(buildTopFutures(topFuturesRaw).map(({ secid }) => secid));
  const futures = new Map<string, Record<string, unknown>>();
  for (const raw of [fortsRaw, topFuturesRaw]) {
    for (const row of parseIssTable(raw, "securities")) {
      if (typeof row.SECID === "string") futures.set(row.SECID, row);
    }
  }
  const futuresAssets: Record<string, string> = {
    BR: "BR", NG: "NG", GD: "GOLD", MX: "MIX", RI: "RTS",
    SI: "Si", EU: "Eu", CR: "CNY",
  };
  for (const contract of val(futuresCatalogR) ?? []) {
    if (contract.classCode !== "SPBFUT") continue;
    const symbol = contract.ticker;
    const prefix = symbol.match(/^([A-Z]+)[FGHJKMNQUVXZ]\d$/i)?.[1];
    const asset = prefix ? futuresAssets[prefix.toUpperCase()] : undefined;
    const expiry = contract.lastTradeDate?.slice(0, 10);
    if (!futures.has(symbol) && asset && expiry && expiry >= today) {
      futures.set(symbol, {
        SECID: symbol, SHORTNAME: contract.name, ASSETCODE: asset, LASTTRADEDATE: expiry,
      });
    }
  }
  const futuresIds: string[] = [];
  for (const q of previous?.topFuturesByVolume ?? []) {
    if (futures.has(q.secid)) rankedFutures.add(q.secid);
    else {
      const id = q.secid + "_SPBFUT";
      instruments.set(q.secid, id);
      futuresIds.push(id);
    }
  }
  const futuresUids = new Map((val(futuresCatalogR) ?? [])
    .filter((contract) => contract.classCode === "SPBFUT")
    .map((contract) => [contract.ticker, contract.uid]));
  const visibleAssets = new Set(Object.values(futuresAssets));
  for (const [symbol, row] of futures) {
    if (!rankedFutures.has(symbol) && !visibleAssets.has(String(row.ASSETCODE))) continue;
    const id = futuresUids.get(symbol) ?? `${symbol}_SPBFUT`;
    instruments.set(symbol, id);
    futuresIds.push(id);
  }

  // Неподдерживаемый индекс или валютная пара не должны мешать акциям.
  const priceGroups = await Promise.all([
    getTBankPrices(stockIds),
    getTBankPrices(futuresIds),
    ...[...fxSymbols, ...indexSymbols].map((symbol) => getTBankPrices([instruments.get(symbol)!])),
  ]);
  const tbankPrices = new Map(priceGroups.flatMap((group) => [...group]));
  const tbank = new Map<string, ProviderQuote>();
  for (const [symbol, id] of instruments) {
    const price = tbankPrices.get(id);
    if (validPrice(price)) tbank.set(symbol, price);
  }
  const alor = await fetchAlorQuotes([...instruments.keys()].filter((symbol) => !tbank.has(symbol)));
  const merge = (
    raw: unknown,
    symbols: string[],
    price: "LAST" | "CURRENTVALUE" = "LAST",
    securities = parseIssTable(raw, "securities"),
  ) => ({
    securities: issTable(securities),
    marketdata: issTable(mergeQuoteRows(parseIssTable(raw, "marketdata"), symbols, price, tbank, alor)),
  });
  const indicesJson = merge(val(indicesR), indexSymbols, "CURRENTVALUE");
  const stocksJson = merge(stocksRaw, STOCK_TICKERS);
  const fortsJson = merge(fortsRaw, [...futures.keys()], "LAST", [...futures.values()]);
  const fxTomJson = merge(val(fxTomR), fxSymbols);
  const topStocksJson = merge(topStocksRaw, [...stockSymbols]);
  const topFuturesJson = merge(topFuturesRaw, [...futures.keys()], "LAST", [...futures.values()]);

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
  const currencies: Quote[] = buildCurrencies(cbrJson, fxTomJson, today).map((q) => {
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
    stocks: buildStocks(stocksJson).filter((quote) => quote.last !== null),
    commodities: fortsJson ? buildCommodities(fortsJson) : [],
    currencies,
    topStocksByVolume: fullScope ? buildTopStocks(topStocksJson) : [],
    topFuturesByVolume: fullScope ? buildTopFutures(topFuturesJson) : [],
    sectorStocks: fullScope ? buildSectorStocks(topStocksJson) : [],
    sparklines: {
      imoex: buildSparkline(val(sparkImoexR)),
      rtsi: buildSparkline(val(sparkRtsiR)),
    },
    moexTime: maxUpdateTime(indicesJson, stocksJson),
    cbrDate,
    alorUsed: alor.size > 0,
  };

  const receivedAt = new Date().toISOString();
  body.calendarDay = today;
  body.rankingTimes = {};
  for (const field of ["topStocksByVolume", "topFuturesByVolume"] as const) {
    if (body[field].length === 20 || (body[field].length && !previous?.[field].length)) {
      body.rankingTimes[field] = receivedAt;
    }
    else if (previous?.rankingTimes?.[field] &&
      Date.now() - Date.parse(previous.rankingTimes[field]) < 7 * 86400000) {
      body.rankingTimes[field] = previous.rankingTimes[field];
      body[field] = previous[field].map(q => {
        const price = tbank.get(q.secid) ?? alor.get(q.secid);
        return price ? {...q, last: price.last, open: price.open ?? null, high: price.high ?? null, low: price.low ?? null, cached: false} : {...q, cached: true};
      });
    }
  }
  for (const q of [...body.indices, ...body.currencies, ...body.commodities, ...body.stocks,
    ...body.topStocksByVolume, ...body.topFuturesByVolume, ...body.sectorStocks.flatMap(g => g.quotes)]) {
    if (q.cached) continue;
    const id = q.secid === "IMOEX" ? "IMOEX2" : q.secid;
    const tb = tbank.get(id), broker = alor.get(id);
    q.source = tb ? "Т-Инвестиции" : broker ? "Алор" : id.endsWith("_CBR") ? "ЦБ" : "Мосбиржа";
    q.observedAt = tb?.time ?? broker?.time;
    q.receivedAt = receivedAt;
  }
  await applyCalendarChange(body, fullScope ? topFuturesJson : fortsJson, instruments, today, startedAt + 47000);
  restoreMissing(body, previous);
  if (!fullScope) body.sectorStocks = [];
  if (!body.indices.length && !body.stocks.length && !body.currencies.length && !body.commodities.length) {
    return NextResponse.json({error: "Источники котировок недоступны"}, {status: 502});
  }
  await cache.set(cacheKey, body, {ttl: 7 * 86400}).catch(() => undefined);
  return NextResponse.json(body);
}
