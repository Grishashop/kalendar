/**
 * Сводка по пачке перед отправкой в карман.
 *
 * Считается по готовому плану, а не по своим формулам: план уже применил
 * выражения шаблона, правило отсева и ценообразование, поэтому сводка не может
 * разойтись с тем, что уйдёт в файл.
 *
 * Денежный объём здесь принципиально не считается: цен во вставке из QUIK нет,
 * а котировка есть не всегда.
 */

import type { Plan } from "./generate";

export interface DirectionTotal {
  direction: string;
  orders: number;
  contracts: number;
}

/**
 * Итог по одному инструменту. Считается по всей вставке, а не только по
 * отмеченному: это то, ПО ЧЕМУ принимают решение о включении инструмента.
 * Число, зависящее от текущей галочки, показывало бы у выключенного нуль —
 * то есть ровно ничего.
 */
export interface InstrumentTotal {
  instrument: string;
  orders: number;
  contracts: number;
  /** Контракты в длинной позиции — закрываются продажей. */
  long: number;
  /** Контракты в короткой позиции — закрываются покупкой. */
  short: number;
  /** Индексы строк позиций — по ним чип переключает отбор. */
  rows: number[];
  /** Сколько из этих строк отмечено: 0, все или частично. */
  enabledCount: number;
}

export interface Stats {
  /** Строк, которые станут заявками на закрытие. */
  orders: number;
  contracts: number;
  byDirection: DirectionTotal[];
  instruments: number;
  accounts: number;
  /** Инструменты всей вставки по алфавиту; отмеченные уйдут в карман. */
  byInstrument: InstrumentTotal[];
  largest: { account: string; instrument: string; direction: string; contracts: number } | null;
  /** Пары «счёт + инструмент», встречающиеся больше одного раза. */
  duplicates: string[];
  /** Заявок и стоп-заявок на снятие в пачке. */
  cancels: number;
  stopCancels: number;
  /** Сколько заявок уйдёт лимитными и сколько рыночными. */
  limitOrders: number;
  marketOrders: number;
  /** Строки, не прошедшие проверку контракта. */
  checkFailed: number;
  skipped: number;
  failed: number;
}

export function computeStats(plan: Plan, enabled: readonly boolean[]): Stats | null {
  if (plan.templateError) return null;

  const byDirection = new Map<string, DirectionTotal>();
  const byInstrument = new Map<string, InstrumentTotal>();
  const pairs = new Map<string, number>();
  const accounts = new Set<string>();

  let orders = 0;
  let contracts = 0;
  let cancels = 0;
  let stopCancels = 0;
  let limitOrders = 0;
  let marketOrders = 0;
  let checkFailed = 0;
  let skipped = 0;
  let failed = 0;
  let largest: Stats["largest"] = null;

  const included = new Set<string>();

  for (const item of plan.positions) {
    if (item.check.verdict !== "ok" && item.check.verdict !== "unchecked") checkFailed += 1;

    // Чипы считаются до отбора: выключенный инструмент обязан остаться видимым
    // со своими числами, иначе его нечем будет включить обратно.
    // Строки, которые не станут заявками ни при каких галочках, сюда не идут.
    if (!item.skip && !item.error) {
      const perInstrument = byInstrument.get(item.instrument) ?? {
        instrument: item.instrument,
        orders: 0,
        contracts: 0,
        long: 0,
        short: 0,
        rows: [],
        enabledCount: 0,
      };
      perInstrument.orders += 1;
      perInstrument.contracts += item.quantity;
      // Покупка закрывает шорт, продажа — лонг: сторона заявки обратна стороне позиции.
      if (item.buying) perInstrument.short += item.quantity;
      else perInstrument.long += item.quantity;
      perInstrument.rows.push(item.index);
      if (enabled[item.index]) perInstrument.enabledCount += 1;
      byInstrument.set(item.instrument, perInstrument);
    }

    if (!enabled[item.index] || item.skip) {
      skipped += 1;
      continue;
    }
    if (item.error) {
      failed += 1;
      skipped += 1;
      continue;
    }

    orders += 1;
    contracts += item.quantity;
    accounts.add(item.account);
    cancels += item.cancels.length;
    stopCancels += item.stopCancels.length;
    if (item.priceType === "limit") limitOrders += 1;
    else marketOrders += 1;

    const total = byDirection.get(item.direction) ?? {
      direction: item.direction,
      orders: 0,
      contracts: 0,
    };
    total.orders += 1;
    total.contracts += item.quantity;
    byDirection.set(item.direction, total);

    included.add(item.instrument);

    const pair = `${item.account} · ${item.instrument}`;
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);

    if (!largest || item.quantity > largest.contracts) {
      largest = {
        account: item.account,
        instrument: item.instrument,
        direction: item.direction,
        contracts: item.quantity,
      };
    }
  }

  return {
    orders,
    contracts,
    byDirection: [...byDirection.values()].sort((a, b) => b.contracts - a.contracts),
    // Крупная цифра считает то, что уйдёт в карман, а не то, что во вставке.
    instruments: included.size,
    accounts: accounts.size,
    byInstrument: [...byInstrument.values()].sort((a, b) =>
      a.instrument.localeCompare(b.instrument),
    ),
    largest,
    duplicates: [...pairs]
      .filter(([, count]) => count > 1)
      .map(([pair]) => pair)
      .sort(),
    cancels,
    stopCancels,
    limitOrders,
    marketOrders,
    checkFailed,
    skipped,
    failed,
  };
}
