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

/** Карточка инструмента — уточнение: не дождались, обойдёмся правилом дат. */
const CARD_TIMEOUT_MS = 7000;

/**
 * Список контрактов — единственный незаменимый запрос: без него проверки нет
 * вовсе. Ему нужен запас: он идёт на холодном кэше одновременно с котировками,
 * и семи секунд под нагрузкой не хватало.
 */
const LIST_TIMEOUT_MS = 25000;

/** Карточек одновременно; больше — ISS начинает отваливаться по таймауту. */
const CARD_BATCH = 3;

/** Общий бюджет на уточнение по карточкам: сверх него остаётся вердикт по датам. */
const CARD_BUDGET_MS = 8000;

// Просим только нужные колонки: полная выдача по 470 контрактам вчетверо тяжелее.
const FORTS_LIST_URL =
  "https://iss.moex.com/iss/engines/futures/markets/forts/securities.json" +
  "?iss.meta=off&iss.only=securities" +
  "&securities.columns=SECID,ASSETCODE,LASTTRADEDATE,LASTDELDATE,MINSTEP,HIGHLIMIT,LOWLIMIT";

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
  /** Поставочный контракт. Если карточка ISS не ответила — вывод по датам исполнения. */
  deliverable: boolean;
  /** Признак подтверждён карточкой `EXECTYPE`, а не выведен из дат. */
  deliverableConfirmed: boolean;
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
async function fetchIssTable(url: string, block: string, timeoutMs: number): Promise<IssTable> {
  let body: Record<string, IssTable | undefined>;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
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
  const table = await fetchIssTable(FORTS_LIST_URL, "securities", LIST_TIMEOUT_MS);

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
 * Уточняет поставочность по карточкам инструментов — но только в пределах
 * бюджета времени и только сверх правила дат.
 *
 * Карточка авторитетнее, однако ISS режет одновременные запросы: 22 карточки
 * разом дали 6 таймаутов, порциями по три с сервера — всё равно единичные.
 * Поэтому опрос ограничен и по параллелизму, и по общему времени: не успели —
 * остаётся вердикт по датам, а не «неизвестно». Пустой ответ здесь хуже
 * приблизительного: он лишает оператора проверки вовсе.
 */
async function refineDeliverable(index: FortsIndex, sampleByAsset: Map<string, string>): Promise<void> {
  const pending = [...sampleByAsset].filter(([asset]) => !index.deliverable.has(asset));
  const deadline = Date.now() + CARD_BUDGET_MS;

  for (let from = 0; from < pending.length && Date.now() < deadline; from += CARD_BATCH) {
    const batch = await Promise.all(
      pending.slice(from, from + CARD_BATCH).map(async ([asset, sampleSecid]) => {
        const url = `https://iss.moex.com/iss/securities/${encodeURIComponent(sampleSecid)}.json?iss.meta=off&iss.only=description`;
        try {
          const table = await fetchIssTable(url, "description", CARD_TIMEOUT_MS);
          const nameAt = table.columns.indexOf("name");
          const valueAt = table.columns.indexOf("value");
          const row =
            nameAt === -1 || valueAt === -1
              ? undefined
              : table.data.find((r) => r[nameAt] === "EXECTYPE");
          if (row) return [asset, row[valueAt] === DELIVERABLE_EXECTYPE] as const;
        } catch {
          // Молча: правило дат уже дало ответ, карточка была лишь уточнением.
        }
        return null;
      }),
    );

    for (const item of batch) {
      if (item) index.deliverable.set(item[0], item[1]);
    }
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
  await refineDeliverable(index, sampleByAsset);

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
    // Правило дат: у поставочного контракта исполнение на следующий день после
    // окончания обращения, у расчётного — в тот же день. Проверено на всех 187
    // базовых активах FORTS: 186 совпадений с EXECTYPE, единственное расхождение
    // (SUGR) — в безопасную сторону. Обратной ошибки, когда поставочный сочли бы
    // расчётным и исключили из пачки, правило не даёт.
    const byDates = row.deliveryDate !== row.lastTradeDate;
    const confirmed = index.deliverable.get(row.assetCode);
    result[secid] = {
      secid: row.secid,
      assetCode: row.assetCode,
      deliverable: confirmed ?? byDates,
      deliverableConfirmed: confirmed !== undefined,
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
