// Доступ к разделам: у каждого раздела режим, у режима «по списку» — перечень
// трейдеров. Решение и отвергнутые варианты —
// docs/adr/0011-dostup-k-razdelam-v-middleware.md
//
// Модуль чистый: без импортов Next и без обращений к сети. Снимок доступа
// добывает вызывающий (middleware — под сессией запроса, клиент — через
// supabase/client), а здесь живёт только правило и кэш.

/** Раздел — страница вместе с обслуживающими её серверными маршрутами. */
export type Page = "market" | "karman" | "ticker";

/**
 * Режим доступа. `public` разрешён только «Маркету»: за «Карманом»
 * и «Тикерами» стоит приватный токен Alor, и публичный режим отдал бы его
 * анониму. Ограничение продублировано в CHECK базы — соседний пункт
 * выпадающего списка слишком дешёвая ошибка, чтобы держать её только в UI.
 */
export type AccessMode = "public" | "authenticated" | "list";

export const PAGES: readonly Page[] = ["market", "karman", "ticker"];

/** Человекочитаемые названия — для админки и для сообщения об отказе. */
export const PAGE_LABELS: Record<Page, string> = {
  market: "Маркет",
  karman: "Карман транзакций",
  ticker: "Тикеры",
};

/** Разделы, которым разрешён публичный режим. */
export const PUBLIC_CAPABLE: readonly Page[] = ["market"];

export function modesFor(page: Page): readonly AccessMode[] {
  return PUBLIC_CAPABLE.includes(page)
    ? ["public", "authenticated", "list"]
    : ["authenticated", "list"];
}

export const MODE_LABELS: Record<AccessMode, string> = {
  public: "Публично, без входа",
  authenticated: "Всем вошедшим",
  list: "По списку",
};

/**
 * Режимы дня выката. Они же — поведение при отсутствии таблиц: замок,
 * ломающийся в закрытую сторону при неприменённой миграции, оставил бы
 * команду без инструментов.
 */
export const DEFAULT_MODES: Record<Page, AccessMode> = {
  market: "public",
  karman: "authenticated",
  ticker: "authenticated",
};

/** Снимок всего состояния доступа: три режима и списки почт. */
export interface AccessSnapshot {
  modes: Record<Page, AccessMode>;
  /** Почты допущенных трейдеров по разделам. Почта, а не id: у запроса есть
   *  только она — из токена входа. */
  allowed: Record<Page, readonly string[]>;
}

export const OPEN_SNAPSHOT: AccessSnapshot = {
  modes: DEFAULT_MODES,
  allowed: { market: [], karman: [], ticker: [] },
};

/**
 * Соответствие пути разделу. Проверяется по префиксу, порядок важен: более
 * длинный путь должен стоять раньше короткого.
 *
 * `/api/ticker/quotes` отвечает двум разделам — котировки нужны и «Тикерам»,
 * и «Карману» (lib/karman/market.ts). Дублировать маршрут ради карты «один
 * раздел — один префикс» отвергнуто: появились бы два адреса к одному платному
 * токену. Привязать его к одним «Тикерам» нельзя: без котировок цена заявки
 * молча деградирует в рыночную (ADR-0008).
 */
const ROUTE_MAP: readonly { prefix: string; pages: readonly Page[] }[] = [
  { prefix: "/api/ticker/quotes", pages: ["ticker", "karman"] },
  { prefix: "/api/market", pages: ["market"] },
  { prefix: "/api/karman", pages: ["karman"] },
  { prefix: "/api/ticker", pages: ["ticker"] },
  { prefix: "/market", pages: ["market"] },
  { prefix: "/karman", pages: ["karman"] },
  { prefix: "/ticker", pages: ["ticker"] },
];

/**
 * Разделы, отвечающие за путь. Пустой массив — путь вне механизма, пускать
 * по общим правилам входа.
 */
export function pagesForPath(pathname: string): readonly Page[] {
  for (const entry of ROUTE_MAP) {
    if (pathname === entry.prefix || pathname.startsWith(entry.prefix + "/")) {
      return entry.pages;
    }
  }
  return [];
}

export type Verdict = "allow" | "needLogin" | "denied";

/**
 * Вердикт по одному разделу. `needLogin` и `denied` различаются намеренно:
 * анониму нужен вход, а вошедшему — доступ, и сообщения не должны лгать.
 */
export function verdictFor(
  snapshot: AccessSnapshot,
  page: Page,
  email: string | null,
): Verdict {
  const mode = snapshot.modes[page] ?? DEFAULT_MODES[page];
  if (mode === "public") return "allow";
  if (!email) return "needLogin";
  if (mode === "authenticated") return "allow";
  const allowed = snapshot.allowed[page] ?? [];
  return allowed.includes(email.toLowerCase()) ? "allow" : "denied";
}

/**
 * Вердикт по пути. Путь, за который отвечают два раздела, открыт при доступе
 * хотя бы к одному: `/api/ticker/quotes` нужен и «Тикерам», и «Карману».
 *
 * Из нескольких отказов выбирается `needLogin`: вход — первое, что нужно
 * сделать, и предлагать его полезнее, чем сообщать об отсутствии доступа
 * человеку, который ещё не вошёл.
 */
export function verdictForPath(
  snapshot: AccessSnapshot,
  pathname: string,
  email: string | null,
): { verdict: Verdict; page: Page | null } {
  const pages = pagesForPath(pathname);
  if (pages.length === 0) return { verdict: "allow", page: null };

  let fallback: { verdict: Verdict; page: Page } | null = null;
  for (const page of pages) {
    const verdict = verdictFor(snapshot, page, email);
    if (verdict === "allow") return { verdict: "allow", page };
    if (!fallback || (verdict === "needLogin" && fallback.verdict === "denied")) {
      fallback = { verdict, page };
    }
  }
  return fallback!;
}

/** Разделы, открытые этой почте — для скрытия навигации. */
export function visiblePages(
  snapshot: AccessSnapshot,
  email: string | null,
): readonly Page[] {
  return PAGES.filter((page) => verdictFor(snapshot, page, email) === "allow");
}

// ============================================================
// Кэш
// ============================================================

/**
 * Снимок живёт 5 секунд. Замер показал, что запрос десяти строк и запрос одной
 * стоят одинаково (0.78 с против 0.75 с) — время определяет задержка сети,
 * не объём, поэтому забирается вся таблица разом и обслуживает всех сразу.
 *
 * Пять секунд, а не тридцать: отзыв доступа должен быть практически мгновенным,
 * а цена — не больше двенадцати запросов в минуту на инстанс.
 */
export const SNAPSHOT_TTL_MS = 5000;

let cached: { snapshot: AccessSnapshot; at: number } | null = null;
let inFlight: Promise<AccessSnapshot> | null = null;

/**
 * Отдаёт снимок из кэша либо забирает через `load`. Параллельные запросы
 * разделяют одну загрузку: на холодном инстансе первая же навигация тянет
 * несколько запросов сразу, и без этого они пошли бы в базу пачкой.
 */
export async function getSnapshot(
  load: () => Promise<AccessSnapshot>,
  now: number = Date.now(),
): Promise<AccessSnapshot> {
  if (cached && now - cached.at < SNAPSHOT_TTL_MS) return cached.snapshot;
  if (inFlight) return inFlight;

  inFlight = load()
    .then((snapshot) => {
      cached = { snapshot, at: Date.now() };
      return snapshot;
    })
    .catch(() => {
      // Недоступная база не должна запирать команду: отдаём режимы
      // по умолчанию, то есть нынешнее поведение. Не кэшируем — иначе
      // одна сетевая неудача продлилась бы на весь TTL.
      return OPEN_SNAPSHOT;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Сброс кэша — после правки доступа в админке и в тестах. */
export function resetSnapshotCache(): void {
  cached = null;
  inFlight = null;
}
