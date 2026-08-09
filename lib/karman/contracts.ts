/**
 * Справочник фьючерсных контрактов FORTS по данным MOEX ISS.
 *
 * Нужен генератору транзакций, чтобы отличить поставочный контракт от
 * расчётного и понять, ближайшая ли это серия: по ближайшей поставочной серии
 * позицию нельзя держать до конца обращения, иначе придёт поставка.
 *
 * Признак поставочности постоянен для всех серий одного базового актива, поэтому
 * карточка запрашивается один раз на ASSETCODE, а не на каждый контракт.
 */

import "server-only";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 7000;

const FORTS_LIST_URL =
  "https://iss.moex.com/iss/engines/futures/markets/forts/securities.json?iss.meta=off&iss.only=securities";

/** Значение поля EXECTYPE в карточке инструмента для поставочного контракта. */
const DELIVERABLE_EXECTYPE = "Поставочный";

/** ISS отдаёт даты как "ГГГГ-ММ-ДД"; локаль en-CA даёт ровно этот формат, а не ISO с временем. */
const MOSCOW_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface ContractInfo {
  secid: string;
  assetCode: string;
  /** null — карточка инструмента не загрузилась, поставочность неизвестна. */
  deliverable: boolean | null;
  /** Последний день обращения, "ГГГГ-ММ-ДД". */
  lastTradeDate: string;
  /** Дата исполнения (LSTDELDATE), "ГГГГ-ММ-ДД". */
  deliveryDate: string;
  minStep: number;
  highLimit: number;
  lowLimit: number;
  /** Это ближайшая по дате серия своего базового актива среди ещё обращающихся. */
  isNearest: boolean;
  /** Код ближайшей серии этого актива; null — обращающихся серий не осталось. */
  nearestSecid: string | null;
}

interface IssTable {
  columns: string[];
  data: unknown[][];
}

interface FortsRow {
  secid: string;
  assetCode: string;
  lastTradeDate: string;
  deliveryDate: string;
  minStep: number;
  highLimit: number;
  lowLimit: number;
}

interface FortsIndex {
  bySecid: Map<string, FortsRow>;
  /** ASSETCODE -> все его серии, включая уже отторгованные. */
  byAsset: Map<string, FortsRow[]>;
  /**
   * ASSETCODE -> поставочность. Наполняется по мере запросов и живёт до конца дня.
   * Отсутствие ключа означает «ещё не спрашивали», значение null — «спросили и не узнали».
   */
  deliverable: Map<string, boolean | null>;
}

/** Кэш на торговый день: без него каждая генерация тянет ~470 строк списка и десятки карточек. */
let indexCache: { day: string; index: Promise<FortsIndex> } | null = null;

/**
 * Достаёт именованный блок ответа ISS.
 * Любая неудача — сеть, таймаут, не-2xx, сломанная структура — это
 * Error("iss_unavailable"): вызывающий обязан отличить «проверка не выполнена»
 * от «контракт не найден».
 */
async function fetchIssTable(url: string, block: string): Promise<IssTable> {
  let body: Record<string, IssTable | undefined>;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error("iss_unavailable");
    }
    body = (await res.json()) as Record<string, IssTable | undefined>;
  } catch {
    throw new Error("iss_unavailable");
  }

  const table = body[block];
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.data)) {
    throw new Error("iss_unavailable");
  }
  return table;
}

async function buildFortsIndex(): Promise<FortsIndex> {
  const table = await fetchIssTable(FORTS_LIST_URL, "securities");

  const secidAt = table.columns.indexOf("SECID");
  const assetAt = table.columns.indexOf("ASSETCODE");
  const lastTradeAt = table.columns.indexOf("LASTTRADEDATE");
  const deliveryAt = table.columns.indexOf("LASTDELDATE");
  const stepAt = table.columns.indexOf("MINSTEP");
  const highAt = table.columns.indexOf("HIGHLIMIT");
  const lowAt = table.columns.indexOf("LOWLIMIT");
  if ([secidAt, assetAt, lastTradeAt, deliveryAt, stepAt, highAt, lowAt].includes(-1)) {
    throw new Error("iss_unavailable");
  }

  const bySecid = new Map<string, FortsRow>();
  const byAsset = new Map<string, FortsRow[]>();
  for (const row of table.data) {
    // Пустое поле ISS отдаёт как null: у чисел это отсутствие данных (NaN), а не ноль.
    const parsed: FortsRow = {
      secid: String(row[secidAt] ?? ""),
      assetCode: String(row[assetAt] ?? ""),
      lastTradeDate: String(row[lastTradeAt] ?? ""),
      deliveryDate: String(row[deliveryAt] ?? ""),
      minStep: Number(row[stepAt] ?? Number.NaN),
      highLimit: Number(row[highAt] ?? Number.NaN),
      lowLimit: Number(row[lowAt] ?? Number.NaN),
    };
    if (parsed.secid.length === 0) continue;

    bySecid.set(parsed.secid, parsed);
    const series = byAsset.get(parsed.assetCode);
    if (series) {
      series.push(parsed);
    } else {
      byAsset.set(parsed.assetCode, [parsed]);
    }
  }
  return { bySecid, byAsset, deliverable: new Map() };
}

function fortsIndex(day: string): Promise<FortsIndex> {
  const cached = indexCache;
  if (cached && cached.day === day) return cached.index;

  const index = buildFortsIndex();
  // Отказ ISS не должен залипнуть в кэше на весь день: следующий вызов пробует снова.
  index.catch(() => {
    if (indexCache?.index === index) indexCache = null;
  });
  indexCache = { day, index };
  return index;
}

/**
 * Дополняет карту поставочности по активам, которых в ней ещё нет.
 * Одна карточка на актив, все параллельно.
 *
 * Сбой одной карточки не отменяет проверку всей пачки: ISS периодически
 * отвечает по отдельным инструментам дольше таймаута, и валить из-за этого
 * весь справочник — значит терять проверку и по остальным контрактам.
 * Неудача сужается до своего актива и попадает в карту как `null`, а не
 * как «расчётный»: тихая подмена здесь равна пропущенной поставке.
 */
async function loadDeliverable(index: FortsIndex, sampleByAsset: Map<string, string>): Promise<void> {
  const pending = [...sampleByAsset].filter(([asset]) => !index.deliverable.has(asset));
  const loaded = await Promise.all(
    pending.map(async ([asset, sampleSecid]) => {
      const url = `https://iss.moex.com/iss/securities/${encodeURIComponent(sampleSecid)}.json?iss.meta=off&iss.only=description`;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const table = await fetchIssTable(url, "description");
          const nameAt = table.columns.indexOf("name");
          const valueAt = table.columns.indexOf("value");
          const row =
            nameAt === -1 || valueAt === -1
              ? undefined
              : table.data.find((r) => r[nameAt] === "EXECTYPE");
          if (row) return [asset, row[valueAt] === DELIVERABLE_EXECTYPE] as const;
        } catch {
          // Вторая попытка: таймаут ISS по отдельной карточке часто разовый.
        }
      }
      return [asset, null] as const;
    }),
  );

  for (const [asset, deliverable] of loaded) {
    index.deliverable.set(asset, deliverable);
  }
}

/**
 * Справка по каждому запрошенному коду; null — такого контракта в FORTS нет.
 * Бросает Error("iss_unavailable"), если ISS недоступен.
 */
export async function loadContracts(secids: readonly string[]): Promise<Record<string, ContractInfo | null>> {
  const today = MOSCOW_DAY.format(new Date());
  const index = await fortsIndex(today);

  const sampleByAsset = new Map<string, string>();
  for (const secid of secids) {
    const row = index.bySecid.get(secid);
    if (row) sampleByAsset.set(row.assetCode, row.secid);
  }
  await loadDeliverable(index, sampleByAsset);

  // Ближайшая серия считается один раз на актив и не зависит от поставочности:
  // это два независимых факта, и смешивать их значит терять один при незнании другого.
  const nearestByAsset = new Map<string, string | null>();
  for (const asset of sampleByAsset.keys()) {
    let nearest: FortsRow | null = null;
    for (const series of index.byAsset.get(asset) ?? []) {
      // Даты "ГГГГ-ММ-ДД" сравниваются лексикографически, отторгованные серии отсекаются по сегодня в Москве.
      if (series.lastTradeDate < today) continue;
      if (!nearest || series.lastTradeDate < nearest.lastTradeDate) nearest = series;
    }
    nearestByAsset.set(asset, nearest?.secid ?? null);
  }

  const result: Record<string, ContractInfo | null> = {};
  for (const secid of secids) {
    const row = index.bySecid.get(secid);
    if (!row) {
      result[secid] = null;
      continue;
    }
    const nearestSecid = nearestByAsset.get(row.assetCode) ?? null;
    result[secid] = {
      secid: row.secid,
      assetCode: row.assetCode,
      deliverable: index.deliverable.get(row.assetCode) ?? null,
      lastTradeDate: row.lastTradeDate,
      deliveryDate: row.deliveryDate,
      minStep: row.minStep,
      highLimit: row.highLimit,
      lowLimit: row.lowLimit,
      isNearest: nearestSecid !== null && nearestSecid === row.secid,
      nearestSecid,
    };
  }
  return result;
}
