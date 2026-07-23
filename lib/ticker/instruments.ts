export type InstrumentKind = "stock" | "bond" | "futures" | "other";

const KIND_LABEL: Record<InstrumentKind, string> = {
  stock: "Акция",
  bond: "Облигация",
  futures: "Фьючерс",
  other: "Инструмент",
};

export function kindLabel(kind: InstrumentKind): string {
  return KIND_LABEL[kind];
}

/** Первые буквы названия для иконки-заглушки, когда нет реального логотипа. */
export function initials(name: string): string {
  const compact = name.replace(/\s+/g, "");
  return compact.slice(0, 2).toUpperCase();
}

/**
 * Классифицирует инструмент по первому символу cfiCode из поиска:
 * E → акция, D → облигация, F → фьючерс, O → опцион (наравне с прочим — "other",
 * своей карточки у опционов в приложении нет). Опционы тоже торгуются на рынке FORTS,
 * поэтому фолбэк "market === FORTS → фьючерс" их раньше ошибочно засчитывал как фьючерсы —
 * явная проверка на "O" идёт раньше фолбэка.
 * Фолбэк, если cfiCode отсутствует: market === "FORTS" → фьючерс.
 */
export function classify(cfiCode: string | null, market: string): InstrumentKind {
  const firstChar = cfiCode?.[0]?.toUpperCase();
  if (firstChar === "E") return "stock";
  if (firstChar === "D") return "bond";
  if (firstChar === "F") return "futures";
  if (firstChar === "O") return "other";
  if (market === "FORTS") return "futures";
  return "other";
}

/** Ответ GET /md/v2/Securities?query= (поиск по тикеру/ISIN/названию). */
export interface SecuritySearchResult {
  symbol: string;
  shortname: string;
  description: string;
  exchange: string;
  market: string;
  type: string;
  lotsize: number;
  facevalue: number;
  cfiCode: string | null;
  cancellation: string | null;
  minstep: number;
  marginbuy: number | null;
  marginsell: number | null;
  priceMax: number | null;
  priceMin: number | null;
  currency: string;
  ISIN: string | null;
  yield: number | null;
  board: string;
  tradingStatus: number;
  tradingStatusInfo: string;
}

/** Один инструмент внутри именованного списка избранного (см. WatchlistCollection). */
export interface WatchItem {
  exchange: string;
  symbol: string;
  shortname: string;
  description: string;
  kind: InstrumentKind;
  isin: string | null;
  currency: string;
  facevalue: number;
  cancellation: string | null;
  minstep: number;
  board: string;
  /** Только у фьючерсов: читаемое имя базового актива ("Аэрофлот" для AFLT-9.26), если найдено. */
  underlyingName: string | null;
}

export function watchItemFromSearchResult(result: SecuritySearchResult): WatchItem {
  // Alor присылает null в отдельных полях для нестандартных инструментов (опционные комбинации,
  // спреды и т.п.), хотя типы это не объявляют — полный список MOEX (для sync) их тоже содержит,
  // поэтому здесь защищаемся значениями по умолчанию, чтобы не ронять всю синхронизацию из-за пары строк.
  return {
    exchange: result.exchange,
    symbol: result.symbol,
    shortname: result.shortname ?? result.symbol,
    description: result.description ?? result.shortname ?? result.symbol,
    kind: classify(result.cfiCode, result.market),
    isin: result.ISIN,
    currency: result.currency ?? "RUB",
    facevalue: result.facevalue ?? 0,
    cancellation: result.cancellation,
    minstep: result.minstep ?? 0.01,
    board: result.board ?? "",
    underlyingName: null,
  };
}

export function watchKey(item: Pick<WatchItem, "exchange" | "symbol">): string {
  return `${item.exchange}:${item.symbol}`;
}

/** Официальная страница инструмента на moex.com — источник новостей/раскрытия информации. */
export function moexUrl(item: Pick<WatchItem, "kind" | "symbol" | "board">): string {
  if (item.kind === "futures") {
    return `https://www.moex.com/ru/contract.aspx?code=${encodeURIComponent(item.symbol)}`;
  }
  return `https://www.moex.com/ru/issue.aspx?board=${encodeURIComponent(item.board)}&code=${encodeURIComponent(item.symbol)}`;
}

/** Ответ GET /md/v2/Securities/{EXCHANGE}:{SYMBOL}/quotes (snake_case). */
export interface Quote {
  symbol: string;
  exchange: string;
  description: string;
  prev_close_price: number;
  last_price: number;
  last_price_timestamp: number;
  high_price: number;
  low_price: number;
  accruedInt: number | null;
  volume: number;
  open_interest: number | null;
  ask: number;
  bid: number;
  ask_vol: number;
  bid_vol: number;
  open_price: number;
  yield: number | null;
  lotsize: number;
  lotvalue: number;
  facevalue: number;
  type: string;
  total_bid_vol: number;
  total_ask_vol: number;
  accrued_interest: number | null;
  change: number;
  change_percent: number;
}

/** Дневная свеча, GET /md/v2/history (tf=D). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Дивиденд, GET /iss/securities/{TICKER}/dividends.json (MOEX ISS). */
export interface Dividend {
  registryCloseDate: string;
  value: number;
  currency: string;
}

/** Купон облигации, GET /iss/statistics/.../bondization/{TICKER}.json (MOEX ISS). */
export interface Coupon {
  couponDate: string;
  value: number;
  valuePercent: number;
}

/** Амортизация/погашение номинала облигации (тот же MOEX ISS-эндпоинт, что и купоны). */
export interface Amortization {
  amortDate: string;
  value: number;
  valuePercent: number;
}

export interface CouponSchedule {
  coupons: Coupon[];
  amortizations: Amortization[];
}

const WATCHLISTS_STORAGE_KEY = "st.watchlists.v1";
const ACTIVE_WATCHLIST_STORAGE_KEY = "st.activeWatchlist.v1";
/** Старый формат (единственный плоский список) — читаем один раз при миграции. */
const LEGACY_WATCHLIST_STORAGE_KEY = "st.watchlist.v1";

/** Именованный список избранных инструментов (например «Акции», «Голубые фишки»). */
export interface WatchlistCollection {
  id: string;
  name: string;
  items: WatchItem[];
}

function createDefaultList(items: WatchItem[] = []): WatchlistCollection {
  return { id: crypto.randomUUID(), name: "Избранное", items };
}

/** Загружает списки избранного; при первом запуске после обновления мигрирует
 *  старый единый список (ключ st.watchlist.v1) в один именованный список. */
export function loadWatchlists(): { lists: WatchlistCollection[]; activeId: string } {
  if (typeof window === "undefined") return { lists: [], activeId: "" };

  let lists: WatchlistCollection[] = [];
  const raw = window.localStorage.getItem(WATCHLISTS_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) lists = parsed;
    } catch {
      lists = [];
    }
  }

  if (lists.length === 0) {
    const legacyRaw = window.localStorage.getItem(LEGACY_WATCHLIST_STORAGE_KEY);
    if (legacyRaw) {
      try {
        const legacyItems = JSON.parse(legacyRaw);
        if (Array.isArray(legacyItems)) lists = [createDefaultList(legacyItems)];
      } catch {
        lists = [];
      }
    }
  }

  if (lists.length === 0) {
    lists = [createDefaultList()];
  }

  const savedActiveId = window.localStorage.getItem(ACTIVE_WATCHLIST_STORAGE_KEY);
  const activeId = savedActiveId && lists.some((list) => list.id === savedActiveId) ? savedActiveId : lists[0].id;

  return { lists, activeId };
}

export function saveWatchlists(lists: WatchlistCollection[], activeId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WATCHLISTS_STORAGE_KEY, JSON.stringify(lists));
  window.localStorage.setItem(ACTIVE_WATCHLIST_STORAGE_KEY, activeId);
}

/** Число знаков после запятой по шагу цены (0.01 → 2; 1 → 0), максимум 6. */
export function decimalsFromMinstep(minstep: number): number {
  if (!Number.isFinite(minstep) || minstep <= 0) return 2;
  for (let decimals = 0; decimals <= 6; decimals++) {
    const scaled = minstep * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return decimals;
  }
  return 6;
}

const RU_LOCALE = "ru-RU";

export function fmtPrice(value: number, decimals: number): string {
  return new Intl.NumberFormat(RU_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function fmtSigned(value: number, decimals: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtPrice(value, decimals)}`;
}

export function fmtPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtPrice(value, 2)} %`;
}

/** Форматирует дату (погашение/экспирация); даты ≥ 9000 года (бессрочные) скрываются. */
export function fmtDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() >= 9000) return null;
  return new Intl.DateTimeFormat(RU_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** Форматирует unix-время сделки в часовом поясе Europe/Moscow. */
export function fmtTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat(RU_LOCALE, {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(unixSeconds * 1000));
}

/** Цвет по направлению изменения цены — общий для списка и детальной карточки. */
export function changeColorClass(change: number | undefined): string {
  if (change === undefined) return "text-zinc-500";
  if (change > 0) return "text-emerald-400";
  if (change < 0) return "text-red-400";
  return "text-zinc-400";
}
