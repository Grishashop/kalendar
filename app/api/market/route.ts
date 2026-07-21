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
  // true, если голубые фишки/юань реально обновлены через авторизованный
  // ALOR (реалтайм) в ЭТОМ ответе — а не остались на данных MOEX (до 15 мин).
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
  revalidateSeconds = 8,
): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        // no-store тут отключил бы Data Cache для этого fetch — с
        // export const dynamic = "force-dynamic" на сам route handler это
        // не влияет, но next.revalidate всё равно даёт дедупликацию
        // одинаковых URL в пределах revalidateSeconds без похода на MOEX/ЦБ.
        next: { revalidate: revalidateSeconds },
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

// --- ALOR (авторизованный, реалтайм) ---
//
// Публичный (без токена) ALOR даёт те же 15 минут задержки, что и MOEX —
// смысла нет. С личным токеном (ALOR_TOKEN, из личного кабинета брокера,
// НИКОГДА не должен попадать в клиентский код — используется только
// здесь, server-side) — реалтайм. Обмен: ALOR_TOKEN — это долгоживущий
// refresh-токен, на каждый запрос меняем его на JWT access-токен (живёт
// 30 минут, но проще получать заново на каждый вызов GET() — обновление
// и так только по явному клику "Обновить" в интерфейсе, не по расписанию,
// лишней частоты не будет).
//
// Только 10 голубых фишек (STOCK_TICKERS) + биржевой юань — топ-20 по
// обороту и фьючерсы остаются на MOEX: ALOR без доп. прав не отдаёт
// объёмы по всему борду для ранжирования, а фьючерсам нужен динамический
// подбор фронт-месяца, которого через ALOR нет.
const ALOR_SYMBOLS =
  STOCK_TICKERS.map((t) => `MOEX:${t}`).join(",") + ",MOEX:CNYRUB_TOM";

interface AlorQuote {
  symbol: string;
  last_price: number | null;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
}

async function getAlorAccessToken(): Promise<string | null> {
  const refreshToken = process.env.ALOR_TOKEN;
  if (!refreshToken) {
    console.error("ALOR_TOKEN не задан в env");
    return null;
  }
  try {
    const res = await fetch(
      `https://oauth.alor.ru/refresh?token=${encodeURIComponent(refreshToken)}`,
      {
        method: "POST",
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      console.error("ALOR refresh HTTP", res.status, await res.text());
      return null;
    }
    const json = (await res.json()) as { AccessToken?: string };
    if (!json.AccessToken) console.error("ALOR refresh: нет AccessToken в ответе", json);
    return json.AccessToken ?? null;
  } catch (e) {
    console.error("ALOR refresh упал:", e);
    return null;
  }
}

// Best-effort: любая ошибка (нет токена, ALOR недоступен, JWT протух) —
// пустая карта, дальше по коду просто остаёмся на данных MOEX.
async function fetchAlorQuotes(): Promise<Map<string, AlorQuote>> {
  const out = new Map<string, AlorQuote>();
  const jwt = await getAlorAccessToken();
  if (!jwt) return out;
  try {
    const res = await fetch(
      `https://api.alor.ru/md/v2/Securities/${ALOR_SYMBOLS}/quotes`,
      {
        headers: { ...FETCH_HEADERS, Authorization: `Bearer ${jwt}` },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      console.error("ALOR quotes HTTP", res.status, await res.text());
      return out;
    }
    const rows = (await res.json()) as AlorQuote[];
    for (const r of rows) {
      if (typeof r.symbol === "string") out.set(r.symbol, r);
    }
  } catch (e) {
    console.error("ALOR quotes упал:", e);
  }
  return out;
}

// Мутирует котировку на месте: реалтайм-цена ALOR вместо 15-минутной
// MOEX. changePct не трогаем — его пересчитает applyWeekendCorrection
// (или он уже верный на буднях) от свежего last, который мы тут поставили.
function applyAlorQuote(
  q: Quote,
  alorSymbol: string,
  alorQuotes: Map<string, AlorQuote>,
): boolean {
  const r = alorQuotes.get(alorSymbol);
  if (!r) return false;
  if (typeof r.last_price === "number") q.last = r.last_price;
  if (typeof r.open_price === "number") q.open = r.open_price;
  if (typeof r.high_price === "number") q.high = r.high_price;
  if (typeof r.low_price === "number") q.low = r.low_price;
  return true;
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

// Раньше искали последний бар СТРОГО ДО "сегодня" по часам — и это ломалось
// ровно в окне между закрытием сессии и полуночью/началом новой сессии:
// "сегодня" (по календарю) уже наступило, а торгов ещё не было, поэтому
// "последний бар до сегодня" оказывался тем же самым баром, что и текущая
// LAST-цена — сравнение с самим собой давало ровно 0% (живой пример:
// SBER показывал 0,0% в 00:33 вторника, хотя по факту цена не менялась
// с закрытия понедельника 23:50, и сравнивать нужно было с закрытием
// ВОСКРЕСЕНЬЯ, а не с "сегодня").
//
// Правильный якорь — не часы, а САМИ ДАННЫЕ: берём дату последнего бара
// в свечах (последний торговый день, за который вообще есть данные —
// это и есть день, к которому относится текущая LAST), и ищем закрытие
// последнего бара СТРОГО ДО этого дня. Не зависит от того, идут ли
// торги прямо сейчас: работает и в разгар обычной сессии (последний
// день в данных — сегодня, ищем вчера), и в паузе между сессиями
// (последний день в данных — вчера/пятница/когда угодно, ищем день
// перед ним) — без угадывания даты по UPDATETIME (у MOEX это только
// HH:MM:SS, без даты, так что читать "дату LAST" напрямую неоткуда).
function closeBeforeLastTradingDay(rows: Record<string, unknown>[]): number | null {
  if (rows.length === 0) return null;
  const lastDay = String(rows[rows.length - 1]["begin"]).slice(0, 10);
  for (let i = rows.length - 1; i >= 0; i--) {
    const day = String(rows[i]["begin"]).slice(0, 10);
    if (day < lastDay) return num(rows[i]["close"]);
  }
  return null;
}

// Раньше все ~50-70 инструментов запускались одним Promise.allSettled
// сразу — сами эти 50-70 одновременных соединений на iss.moex.com (поверх
// первой волны из 9 параллельных запросов чуть выше в GET()) и оказались
// причиной массовых ConnectTimeoutError, воспроизведённых вживую при
// повторных нагрузочных прогонах: после них IMOEX периодически откатывался
// на исходное значение MOEX (снова от пятницы) — не из-за логики
// пересчёта, а потому что сам запрос свечи для него не успевал выполниться.
// Живой пример поймали СНОВА уже после фикса: SBER/VTBR показали -6,8%/
// -5,9% (сырое значение MOEX от пятницы) вместо верных +4,7%/+9,5% —
// прямая проверка тем же кодом секундами позже дала правильный ответ,
// то есть коррекция не сломана, а просто ОДНА неудачная попытка на
// MOEX ISS (флап сети) откатывала на баг, который мы чиним. Раньше
// сознательно не давали ретрай (боялись повторить шторм соединений),
// но close-до-последнего-торгового-дня — стабильные данные (не меняются
// до следующего закрытия сессии), поэтому кэшируем их на 5 минут
// (next.revalidate), а не на 8с как реалтайм-котировки: большинство
// повторных кликов вообще не бьёт по MOEX заново, и это освобождает
// бюджет на второй запрос при неудаче первого.
async function weekendPrevClose(
  spec: CandleSpec,
  secid: string,
  from: string,
): Promise<number | null> {
  try {
    const url =
      `https://iss.moex.com/iss/engines/${spec.engine}/markets/${spec.market}/boards/${spec.board}` +
      `/securities/${encodeURIComponent(secid)}/candles.json` +
      `?interval=60&iss.meta=off&candles.columns=close,begin&from=${from}`;
    const json = await fetchJson(url, 2, 4000, 300);
    return closeBeforeLastTradingDay(parseIssTable(json, "candles"));
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
  from: string,
): Promise<Map<string, number>> {
  const prevClose = new Map<string, number>();
  const deadline = Date.now() + CANDLE_BUDGET_MS;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < jobs.length && Date.now() < deadline) {
      const job = jobs[next++];
      const v = await weekendPrevClose(job.spec, job.secid, from);
      if (v !== null) prevClose.set(job.secid, v);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CANDLE_CONCURRENCY, jobs.length) }, worker),
  );
  return prevClose;
}

// Пересчитывает changePct у всех котировок в body от закрытия торгового
// дня перед последним днём с данными (см. комментарий у
// closeBeforeLastTradingDay). Теперь это единственный источник changePct —
// собственному полю MOEX (LASTTOPREVPRICE/LASTCHANGEPRC) больше не
// доверяем вообще, оно систематически ломалось в выходные/понедельник/
// паузу между сессиями. Мутирует body на месте. fortsAllJson — сырой
// ответ URL_FORTS_ALL: источник нескейленных цен для embedded FutureInfo
// (у них last уже поделён на scale, но % от этого не зависит — делим
// одинаково масштабированные last/prevClose).
async function applyWeekendCorrection(
  body: MarketResponse,
  fortsAllJson: unknown,
  referenceDate: string | undefined,
): Promise<void> {
  // from — старт окна для запроса свечей (не для сравнения, см. выше):
  // PREVDATE у MOEX, если известен, иначе 10 дней назад по умолчанию.
  // Самошкалируется — 2-3 дня на обычные выходные, сколько угодно на
  // длинную приостановку торгов (а там строк всё равно мало — торгов-то
  // не было), без риска молчаливой обрезки MOEX ISS ответа на 500 строк
  // (живой пример был: 45 дней вместо PREVDATE-якоря унесли самые свежие
  // данные за пределы лимита и посчитали коррекцию по стародавним ценам).
  const fromDate = new Date(Date.now() + 3 * 60 * 60 * 1000);
  fromDate.setUTCDate(fromDate.getUTCDate() - 10);
  const from = referenceDate ?? fromDate.toISOString().slice(0, 10);

  const stockSecids = new Set<string>([
    ...STOCK_TICKERS,
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
  const cnySecids = body.currencies.some((q) => q.secid === "CNYRUB_TOM")
    ? ["CNYRUB_TOM"]
    : [];

  const jobs: { secid: string; spec: CandleSpec }[] = [
    ...indexSecids.map((secid) => ({ secid, spec: INDEX_SPEC[secid] })),
    ...[...stockSecids].map((secid) => ({ secid, spec: TQBR_SPEC })),
    ...cnySecids.map((secid) => ({ secid, spec: CETS_SPEC })),
    ...[...futuresSecids].map((secid) => ({ secid, spec: FORTS_SPEC })),
  ];

  const prevClose = await weekendPrevCloseBatch(jobs, from);

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
    applyPct(q, q.secid, q.last);
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

// Фиксированный набор ~40 самых весомых по индексу IMOEX бумаг,
// сгруппированных по отраслям (агрегация по факт. составу и весам IMOEX,
// проверено вручную по live-данным MOEX ISS) — для вида «По отраслям».
// Порядок секторов и бумаг внутри — по убыванию суммарного веса в индексе.
const SECTOR_GROUPS: { sector: string; items: { secid: string; name: string }[] }[] = [
  {
    sector: "Нефть и газ",
    items: [
      { secid: "LKOH", name: "Лукойл" },
      { secid: "GAZP", name: "Газпром" },
      { secid: "TATN", name: "Татнефть" },
      { secid: "NVTK", name: "Новатэк" },
      { secid: "ROSN", name: "Роснефть" },
      { secid: "SNGS", name: "Сургутнефтегаз" },
      { secid: "TRNFP", name: "Транснефть" },
    ],
  },
  {
    sector: "Финансы",
    items: [
      { secid: "SBER", name: "Сбербанк" },
      { secid: "T", name: "Т-Технологии" },
      { secid: "VTBR", name: "ВТБ" },
      { secid: "MOEX", name: "МосБиржа" },
      { secid: "CBOM", name: "МКБ" },
      { secid: "DOMRF", name: "ДОМ.РФ" },
      { secid: "SVCB", name: "Совкомбанк" },
    ],
  },
  {
    sector: "Металлы и добыча",
    items: [
      { secid: "GMKN", name: "Норникель" },
      { secid: "PLZL", name: "Полюс" },
      { secid: "CHMF", name: "Северсталь" },
      { secid: "RUAL", name: "Русал" },
      { secid: "NLMK", name: "НЛМК" },
      { secid: "MAGN", name: "ММК" },
      { secid: "ALRS", name: "АЛРОСА" },
      { secid: "UGLD", name: "ЮГК" },
    ],
  },
  {
    sector: "Технологии",
    items: [
      { secid: "YDEX", name: "Яндекс" },
      { secid: "HEAD", name: "Хэдхантер" },
      { secid: "VKCO", name: "VK" },
      { secid: "POSI", name: "Позитив" },
      { secid: "CNRU", name: "Циан" },
    ],
  },
  {
    sector: "Потребительский сектор",
    items: [
      { secid: "OZON", name: "Озон" },
      { secid: "X5", name: "Х5" },
      { secid: "LENT", name: "Лента" },
      { secid: "RAGR", name: "Русагро" },
      { secid: "MDMG", name: "Мать и Дитя" },
    ],
  },
  {
    sector: "Телекоммуникации",
    items: [
      { secid: "MTSS", name: "МТС" },
      { secid: "RTKM", name: "Ростелеком" },
    ],
  },
  {
    sector: "Электроэнергетика",
    items: [
      { secid: "IRAO", name: "ИнтерРАО" },
      { secid: "MSNG", name: "Мосэнерго" },
    ],
  },
  {
    sector: "Транспорт",
    items: [
      { secid: "AFLT", name: "Аэрофлот" },
      { secid: "FLOT", name: "Совкомфлот" },
    ],
  },
  {
    sector: "Химия",
    items: [{ secid: "PHOR", name: "ФосАгро" }],
  },
];

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
    alorR,
  ] = await Promise.allSettled([
    fetchJson(URL_INDICES),
    fetchJson(URL_STOCKS),
    fetchJson(URL_FORTS),
    fetchJson(URL_CBR),
    fetchJson(URL_CNY),
    fetchJson(candlesUrl("SNDX", "IMOEX2", today)),
    fetchJson(candlesUrl("RTSI", "RTSI", today)),
    fullScope ? fetchJson(URL_STOCKS_ALL) : Promise.resolve(null),
    fullScope ? fetchJson(URL_FORTS_ALL) : Promise.resolve(null),
    fetchAlorQuotes(),
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
    sectorStocks: val(topStocksR) ? buildSectorStocks(val(topStocksR)) : [],
    sparklines: {
      imoex: buildSparkline(val(sparkImoexR)),
      rtsi: buildSparkline(val(sparkRtsiR)),
    },
    moexTime: maxUpdateTime(indicesJson, stocksJson),
    cbrDate,
    alorUsed: false,
  };

  // Реалтайм-цены ALOR поверх голубых фишек/юаня от MOEX (до 15 мин) —
  // только для того, что реально пришло; при сбое (нет токена, ALOR
  // недоступен) остаёмся на данных MOEX без единого намёка на ошибку
  // пользователю — это необязательное улучшение, а не основной источник.
  const alorQuotes = val(alorR) ?? new Map<string, AlorQuote>();
  let alorUsed = false;
  for (const q of body.stocks) {
    if (applyAlorQuote(q, q.secid, alorQuotes)) alorUsed = true;
  }
  for (const q of body.currencies) {
    if (q.secid === "CNYRUB_TOM" && applyAlorQuote(q, "CNYRUB_TOM", alorQuotes)) {
      alorUsed = true;
    }
  }
  body.alorUsed = alorUsed;

  // changePct теперь ВСЕГДА пересчитывается сами (closeBeforeLastTradingDay
  // в applyWeekendCorrection), а не только когда обнаружен рассинхрон
  // PREVDATE у MOEX — своему полю LASTTOPREVPRICE/LASTCHANGEPRC MOEX
  // больше не доверяем вовсе: оно ломалось и в выходные, и в понедельник,
  // и в паузе между сессиями (PREVDATE у MOEX для TQBR/IMOEX не успевает
  // прыгать по календарным дням при вечерних/выходных сессиях). Раньше
  // здесь был гейт "запускать коррекцию только если PREVDATE ≠ вчера" —
  // сама эта эвристика "вчера" и была источником бага (см. коммит про
  // 00:33 вторника). closeBeforeLastTradingDay самодостаточна и всегда
  // даёт корректный результат, гейтить по времени суток незачем.
  //
  // stockPrevDate по-прежнему нужен — не для решения "считать или нет",
  // а как стартовая точка окна запроса свечей (самошкалируется под
  // длину реальной паузы в торгах, см. комментарий в applyWeekendCorrection).
  const stockPrevDate = stocksJson
    ? (parseIssTable(stocksJson, "securities").find(
        (r) => typeof r["PREVDATE"] === "string",
      )?.["PREVDATE"] as string | undefined)
    : undefined;

  // Защита от переполнения maxDuration: если первая волна запросов уже
  // съела больше COOL_TIME_MS — MOEX сегодня медленный/троттлит, и вторая
  // волна (пересчёт %) рискует не уложиться в лимит функции и уронить
  // ВЕСЬ ответ вместо того, чтобы просто оставить часть котировок с
  // исходным (возможно неточным) значением MOEX. Лучше отдать то, что
  // уже есть, чем ничего. Обновление и так только по клику "Обновить" —
  // лишней частоты вызовов, которую раньше экономил гейт по PREVDATE, тут
  // уже нет.
  const COOL_TIME_MS = 12000;
  if (Date.now() - startedAt < COOL_TIME_MS) {
    // topFuturesR — null в компактном режиме (см. fullScope выше); узкий
    // fortsJson (уже получен в любом случае) покрывает все контракты,
    // нужные для commodities/embedded FutureInfo — топ-20 фьючерсов в
    // компактном виде и так пуст, дополнительные контракты не нужны.
    await applyWeekendCorrection(body, val(topFuturesR) ?? fortsJson, stockPrevDate);
  }

  // dynamic = "force-dynamic" выше уже не даёт Next.js кэшировать сам
  // ответ route handler'а — отдельный Cache-Control тут не нужен.
  return NextResponse.json(body);
}
