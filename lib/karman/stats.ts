/**
 * Сводка по пачке перед отправкой в карман.
 *
 * Считается по тем же правилам и тем же выражениям, что и сами транзакции:
 * какие строки войдут, какое у них направление и количество — всё берётся из
 * шаблона, а не пересчитывается по своей формуле. Иначе сводка разошлась бы с
 * выводом при первой правке шаблона.
 *
 * Денежный объём здесь принципиально не считается: цен во вставке из QUIK нет.
 */

import { ExpressionError } from "./expression";
import { compileTemplate, createScope, isSkipped } from "./generate";
import type { Template } from "./template";

export interface DirectionTotal {
  direction: string;
  orders: number;
  contracts: number;
}

export interface Stats {
  /** Строк, которые станут транзакциями. */
  orders: number;
  /** Сумма количеств по всем заявкам. */
  contracts: number;
  byDirection: DirectionTotal[];
  instruments: number;
  accounts: number;
  /** Все инструменты пачки по алфавиту — чтобы глазами проверить состав серии. */
  byInstrument: { instrument: string; orders: number; contracts: number }[];
  largest: { account: string; instrument: string; direction: string; contracts: number } | null;
  /** Пары «счёт + инструмент», встречающиеся больше одного раза. */
  duplicates: string[];
  /** Строк отброшено: снята галочка, правило отсева или ошибка вычисления. */
  skipped: number;
  /** Строк, которые не удалось вычислить. */
  failed: number;
}

export function computeStats(
  template: Template,
  rows: readonly string[][],
  enabled: readonly boolean[],
): Stats | null {
  const compiled = compileTemplate(template);
  if (compiled.error) return null;

  const byDirection = new Map<string, DirectionTotal>();
  const byInstrument = new Map<string, { instrument: string; orders: number; contracts: number }>();
  const pairs = new Map<string, number>();
  const accounts = new Set<string>();

  let orders = 0;
  let contracts = 0;
  let skipped = 0;
  let failed = 0;
  let largest: Stats["largest"] = null;

  rows.forEach((cells, rowIndex) => {
    if (!enabled[rowIndex]) {
      skipped += 1;
      return;
    }

    try {
      const scope = createScope(compiled, template, cells, orders + 1);
      if (isSkipped(compiled, scope)) {
        skipped += 1;
        return;
      }

      const quantity = Number(scope(template.stats.quantity));
      const direction = String(scope(template.stats.direction));
      const instrument = String(scope(template.stats.instrument));
      const account = String(scope(template.stats.account));
      if (!Number.isFinite(quantity)) throw new ExpressionError("количество не число");

      orders += 1;
      contracts += quantity;
      accounts.add(account);

      const total = byDirection.get(direction) ?? { direction, orders: 0, contracts: 0 };
      total.orders += 1;
      total.contracts += quantity;
      byDirection.set(direction, total);

      const perInstrument = byInstrument.get(instrument) ?? { instrument, orders: 0, contracts: 0 };
      perInstrument.orders += 1;
      perInstrument.contracts += quantity;
      byInstrument.set(instrument, perInstrument);

      const pair = `${account} · ${instrument}`;
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);

      if (!largest || quantity > largest.contracts) {
        largest = { account, instrument, direction, contracts: quantity };
      }
    } catch {
      failed += 1;
      skipped += 1;
    }
  });

  return {
    orders,
    contracts,
    byDirection: [...byDirection.values()].sort((a, b) => b.contracts - a.contracts),
    instruments: byInstrument.size,
    accounts: accounts.size,
    byInstrument: [...byInstrument.values()].sort((a, b) =>
      a.instrument.localeCompare(b.instrument),
    ),
    largest,
    duplicates: [...pairs]
      .filter(([, count]) => count > 1)
      .map(([pair]) => pair)
      .sort(),
    skipped,
    failed,
  };
}
