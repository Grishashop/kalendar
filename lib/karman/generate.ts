/**
 * Сборка транзакций: разобранные строки + шаблон + рыночные данные → текст для кармана.
 *
 * Порядок в файле — снятия вплотную перед закрытием своей позиции, сквозная
 * нумерация `TRANS_ID` (см. docs/adr/0009-snyatie-blokiruyushchih-zayavok.md).
 */

import {
  compileExpression,
  compileLine,
  ExpressionError,
  normalizeNumeric,
  type CompiledExpression,
  type CompiledLine,
  type Scope,
  type Value,
} from "./expression";
import { checkContract, type ContractCheck } from "./checks";
import type { ContractInfo } from "./contracts";
import { computePrice, type OrderMode, type Quote } from "./pricing";
import { cellText, parseDate } from "./parse";
import { ROW_NUMBER_COLUMN, type Template, type TemplateColumn } from "./template";

/** Рыночные данные по одному инструменту. */
export interface MarketRow {
  contract: ContractInfo | null;
  quote: Quote | null;
}

export interface CompiledTemplate {
  line: CompiledLine;
  cancelLine: CompiledLine;
  cancelStopLine: CompiledLine;
  skipWhen: CompiledExpression | null;
  values: Map<string, CompiledExpression>;
  columnIndex: Map<string, number>;
  orderIndex: Map<string, number>;
  stopIndex: Map<string, number>;
  error: string | null;
}

/** Псевдоколонки, которые код подставляет строке позиций сверх её собственных. */
const MARKET_COLUMNS = [
  "Цена заявки",
  "Тип заявки",
  "Спрос",
  "Предложение",
  "Посл. цена",
  "Шаг цены",
  "Лимит вверх",
  "Лимит вниз",
  "Возраст котировки",
  // UID трейдера: файлом пользуются несколько человек, поэтому значение вводится
  // на странице, а не правится в шаблоне. Пустая строка означает «без UID»;
  // что при этом попадёт в транзакцию, решает выражение шаблона.
  "UID",
] as const;

const BROKEN: Omit<CompiledTemplate, "error"> = {
  line: compileLine(""),
  cancelLine: compileLine(""),
  cancelStopLine: compileLine(""),
  skipWhen: null,
  values: new Map(),
  columnIndex: new Map(),
  orderIndex: new Map(),
  stopIndex: new Map(),
};

function unknownNames(used: readonly string[], known: ReadonlySet<string>): string[] {
  return [...new Set(used.filter((name) => !known.has(name)))];
}

export function compileTemplate(template: Template): CompiledTemplate {
  try {
    const values = new Map<string, CompiledExpression>();
    for (const [name, source] of Object.entries(template.values)) {
      values.set(name, compileExpression(source));
    }
    const line = compileLine(template.line);
    const cancelLine = compileLine(template.cancelLine);
    const cancelStopLine = compileLine(template.cancelStopLine);
    const skipWhen = template.skipWhen.trim() ? compileExpression(template.skipWhen) : null;

    const indexOf = (columns: readonly TemplateColumn[]) =>
      new Map(columns.map((column, index) => [column.name, index]));
    const columnIndex = indexOf(template.columns);
    const orderIndex = indexOf(template.orderColumns);
    const stopIndex = indexOf(template.stopColumns);

    const positionNames = new Set([
      ...columnIndex.keys(),
      ...values.keys(),
      ...MARKET_COLUMNS,
      ROW_NUMBER_COLUMN,
    ]);
    const problems = [
      ...unknownNames(
        [
          ...line.columns,
          ...(skipWhen?.columns ?? []),
          ...[...values.values()].flatMap((value) => value.columns),
        ],
        positionNames,
      ),
      ...unknownNames(cancelLine.columns, new Set([...orderIndex.keys(), ROW_NUMBER_COLUMN])),
      ...unknownNames(cancelStopLine.columns, new Set([...stopIndex.keys(), ROW_NUMBER_COLUMN])),
    ];
    if (problems.length > 0) {
      return {
        ...BROKEN,
        error:
          "В шаблоне используются имена, которых нет ни среди колонок, ни среди " +
          `выражений: ${[...new Set(problems)].map((name) => `«${name}»`).join(", ")}`,
      };
    }

    return {
      line,
      cancelLine,
      cancelStopLine,
      skipWhen,
      values,
      columnIndex,
      orderIndex,
      stopIndex,
      error: null,
    };
  } catch (error) {
    const message = error instanceof ExpressionError ? error.message : String(error);
    return { ...BROKEN, error: `Ошибка в шаблоне: ${message}` };
  }
}

function cellValue(raw: string, column: TemplateColumn): Value {
  // Тот же нормализатор, что и в проверке ячейки: иначе номер прошёл бы
  // проверку без пробелов, а в транзакцию ушёл бы с ними.
  const value = cellText(raw, column);
  if (column.type === "number") return value ? Number(normalizeNumeric(value)) : 0;
  if (column.type === "date") {
    const date = parseDate(value);
    if (!date) throw new ExpressionError(`не дата: «${value}»`);
    return date as Value;
  }
  return value;
}

/**
 * Область видимости одной строки. Имя разрешается как колонка, затем как
 * псевдоколонка рыночных данных, затем как именованное выражение — данные
 * всегда сильнее формулы. Вычисленные значения кешируются на строку.
 */
export function createScope(
  columns: readonly TemplateColumn[],
  columnIndex: ReadonlyMap<string, number>,
  values: ReadonlyMap<string, CompiledExpression>,
  cells: readonly string[],
  rowNumber: number,
  extra: Readonly<Record<string, Value>> = {},
): Scope {
  const cache = new Map<string, Value>();
  const resolving = new Set<string>();

  const scope: Scope = (name) => {
    if (name === ROW_NUMBER_COLUMN) return rowNumber;

    const index = columnIndex.get(name);
    if (index !== undefined) return cellValue(cells[index], columns[index]);

    if (name in extra) return extra[name];

    const expression = values.get(name);
    if (!expression) throw new ExpressionError(`нет колонки «${name}»`);

    const cached = cache.get(name);
    if (cached !== undefined) return cached;
    if (resolving.has(name)) throw new ExpressionError(`выражение «${name}» ссылается само на себя`);
    resolving.add(name);
    const value = expression.run(scope);
    resolving.delete(name);
    cache.set(name, value);
    return value;
  };

  return scope;
}

// ------------------------------------------------------------------ план

export interface PositionPlan {
  /** Индекс строки в исходном массиве позиций. */
  index: number;
  instrument: string;
  account: string;
  direction: string;
  quantity: number;
  /**
   * Заявка на покупку, то есть откуп короткой позиции. Считается один раз здесь,
   * чтобы потребителям не требовался шаблон ради сравнения с ярлыком стороны.
   */
  buying: boolean;
  check: ContractCheck;
  priceType: OrderMode;
  price: number | null;
  /** Почему заявка не лимитная, хотя просили лимитную. */
  priceReason: string | null;
  /** Индексы строк вставки заявок, снимаемых перед этой позицией. */
  cancels: number[];
  stopCancels: number[];
  /** Расхождение объёма снимаемых заявок с «Акт. покупка» / «Акт. продажа». */
  reconcile: string | null;
  /** Отсеяна правилом шаблона — например, нулевая позиция. */
  skip: boolean;
  /** Псевдоколонки рыночных данных этой строки; считаются один раз. */
  market: Record<string, Value>;
  /** Строка непригодна к генерации: ошибка вычисления или неизвестная цена. */
  error: string | null;
}

export interface PlanInput {
  template: Template;
  rows: readonly string[][];
  orderRows: readonly string[][];
  stopRows: readonly string[][];
  market: Readonly<Record<string, MarketRow | undefined>>;
  /** Справочник загружен; иначе проверка контрактов пропускается. */
  contractsLoaded: boolean;
  mode: OrderMode;
  /** Спред задаётся перед генерацией; шаблон даёт лишь начальное значение. */
  spreadPercent: number;
  cancelOrders: boolean;
  cancelStops: boolean;
  /**
   * UID трейдера для комментария транзакции. Задаётся на странице: файлом
   * пользуются несколько человек, и правка шаблона каждым — верный способ
   * однажды отправить пачку под чужим UID. Пустая строка означает «без UID».
   */
  uid: string;
}

export interface Plan {
  positions: PositionPlan[];
  /** Строки вставки заявок, не привязанные ни к одной позиции. */
  orphanOrders: number[];
  orphanStops: number[];
  /** Строки, отброшенные по состоянию: исполненные и снятые заявки. */
  inactiveOrders: number[];
  inactiveStops: number[];
  templateError: string | null;
}

/** Ключ сопоставления вставок между собой. Регистр счетов в QUIK значим. */
function pairKey(account: string, instrument: string): string {
  return `${account.trim()}\u0000${instrument.trim()}`;
}

export function buildPlan(input: PlanInput): Plan {
  const { template, rows, orderRows, stopRows, market } = input;
  const compiled = compileTemplate(template);
  if (compiled.error) {
    return {
      positions: [],
      orphanOrders: [],
      orphanStops: [],
      inactiveOrders: [],
      inactiveStops: [],
      templateError: compiled.error,
    };
  }

  const roles = template.roles;
  const text = (
    index: Map<string, number>,
    columns: readonly TemplateColumn[],
    cells: readonly string[],
    name: string,
  ) => {
    const at = index.get(name);
    return at === undefined ? "" : cells[at].trim();
  };

  // Снимать имеет смысл только живые заявки: исполненная и снятая ничего не
  // связывают, а их объём не входит в «Акт. покупка» и «Акт. продажа», так что
  // сверка сошлась бы только по активным.
  const activeStatuses = new Set(
    roles.orderActiveStatus
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean),
  );
  const inactiveOrders: number[] = [];

  // Заявки и стоп-заявки заранее раскладываем по паре «счёт + инструмент»:
  // одна позиция может быть заблокирована несколькими заявками.
  const ordersByPair = new Map<string, number[]>();
  orderRows.forEach((cells, i) => {
    const status = text(compiled.orderIndex, template.orderColumns, cells, roles.orderStatus);
    if (status && !activeStatuses.has(status)) {
      inactiveOrders.push(i);
      return;
    }
    const key = pairKey(
      text(compiled.orderIndex, template.orderColumns, cells, roles.orderAccount),
      text(compiled.orderIndex, template.orderColumns, cells, roles.orderInstrument),
    );
    ordersByPair.set(key, [...(ordersByPair.get(key) ?? []), i]);
  });
  const activeStopStatuses = new Set(
    roles.stopActiveStatus
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean),
  );
  const inactiveStops: number[] = [];

  const stopsByPair = new Map<string, number[]>();
  stopRows.forEach((cells, i) => {
    const status = text(compiled.stopIndex, template.stopColumns, cells, roles.stopStatus);
    if (status && !activeStopStatuses.has(status)) {
      inactiveStops.push(i);
      return;
    }
    const key = pairKey(
      text(compiled.stopIndex, template.stopColumns, cells, roles.stopAccount),
      text(compiled.stopIndex, template.stopColumns, cells, roles.stopInstrument),
    );
    stopsByPair.set(key, [...(stopsByPair.get(key) ?? []), i]);
  });

  const usedOrders = new Set<number>();
  const usedStops = new Set<number>();

  const positions = rows.map((cells, index): PositionPlan => {
    const base: PositionPlan = {
      index,
      instrument: "",
      account: "",
      direction: "",
      quantity: 0,
      buying: false,
      check: { verdict: "unchecked", message: null },
      priceType: "market",
      price: null,
      priceReason: null,
      cancels: [],
      stopCancels: [],
      reconcile: null,
      skip: false,
      market: {},
      error: null,
    };

    let instrument: string;
    let account: string;
    let direction: string;
    let quantity: number;
    try {
      const probe = createScope(
        template.columns,
        compiled.columnIndex,
        compiled.values,
        cells,
        index + 1,
      );
      instrument = String(probe(roles.instrument)).trim();
      account = String(probe(roles.account)).trim();
      direction = String(probe(roles.direction)).trim();
      quantity = Number(probe(roles.quantity));
    } catch (error) {
      const message = error instanceof ExpressionError ? error.message : String(error);
      return { ...base, error: message };
    }

    const data = market[instrument];
    const check = checkContract(
      instrument,
      data?.contract,
      text(compiled.columnIndex, template.columns, cells, roles.maturity),
      input.contractsLoaded,
    );

    const buying = direction === roles.directionBuyLabel;
    const price = computePrice({
      direction: buying ? "buy" : "sell",
      mode: input.mode,
      spreadPercent: input.spreadPercent,
      freshnessSec: template.pricing.freshnessSec,
      quote: data?.quote ?? null,
      minStep: data?.contract?.minStep ?? null,
      highLimit: data?.contract?.highLimit ?? null,
      lowLimit: data?.contract?.lowLimit ?? null,
    });

    const key = pairKey(account, instrument);
    const cancels = input.cancelOrders ? (ordersByPair.get(key) ?? []) : [];
    const stopCancels = input.cancelStops ? (stopsByPair.get(key) ?? []) : [];
    cancels.forEach((i) => usedOrders.add(i));
    stopCancels.forEach((i) => usedStops.add(i));

    const marketColumns: Record<string, Value> = {
      "Цена заявки": price.price ?? 0,
      "Тип заявки": price.type === "limit" ? "Лимитированная" : "Рыночная",
      Спрос: data?.quote?.bid ?? 0,
      Предложение: data?.quote?.ask ?? 0,
      "Посл. цена": data?.quote?.last ?? 0,
      "Шаг цены": data?.contract?.minStep ?? 0,
      "Лимит вверх": data?.contract?.highLimit ?? 0,
      "Лимит вниз": data?.contract?.lowLimit ?? 0,
      "Возраст котировки": data?.quote?.ageSec ?? 0,
      UID: input.uid ?? "",
    };

    let skip = false;
    try {
      if (compiled.skipWhen) {
        const verdict = compiled.skipWhen.run(
          createScope(
            template.columns,
            compiled.columnIndex,
            compiled.values,
            cells,
            index + 1,
            marketColumns,
          ),
        );
        skip = verdict === true || (typeof verdict === "number" && verdict !== 0);
      }
    } catch (error) {
      return {
        ...base,
        instrument,
        account,
        direction,
        quantity,
        check,
        market: marketColumns,
        error: error instanceof ExpressionError ? error.message : String(error),
      };
    }

    return {
      ...base,
      instrument,
      account,
      direction,
      quantity,
      buying,
      check,
      priceType: price.type,
      price: price.price,
      priceReason: price.reason,
      cancels,
      stopCancels,
      reconcile: input.cancelOrders
        ? reconcile(template, compiled, cells, orderRows, cancels)
        : null,
      skip,
      market: marketColumns,
      error: price.price === null ? (price.reason ?? "цена неизвестна") : null,
    };
  });

  return {
    positions,
    orphanOrders: orderRows
      .map((_, i) => i)
      .filter((i) => !usedOrders.has(i) && !inactiveOrders.includes(i)),
    inactiveOrders,
    orphanStops: stopRows
      .map((_, i) => i)
      .filter((i) => !usedStops.has(i) && !inactiveStops.includes(i)),
    inactiveStops,
    templateError: null,
  };
}

/**
 * Сверка объёма снимаемых заявок с «Акт. покупка» и «Акт. продажа».
 * Ловит неполную выгрузку: недостающая заявка оставит контракты связанными,
 * закрытие отобьётся, и позиция уедет на поставку.
 */
function reconcile(
  template: Template,
  compiled: CompiledTemplate,
  positionCells: readonly string[],
  orderRows: readonly string[][],
  cancels: readonly number[],
): string | null {
  const roles = template.roles;
  const declared = (name: string) => {
    const at = compiled.columnIndex.get(name);
    if (at === undefined) return null;
    const raw = positionCells[at].trim();
    return raw ? Number(normalizeNumeric(raw)) : 0;
  };

  const expectedBuy = declared(roles.activeBuy);
  const expectedSell = declared(roles.activeSell);
  if (expectedBuy === null && expectedSell === null) return null;

  // Список написаний: одна и та же настройка QUIK даёт то «Купля», то код «B».
  const buyLabels = new Set(
    roles.orderBuyLabel
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean),
  );

  let actualBuy = 0;
  let actualSell = 0;
  for (const i of cancels) {
    const cells = orderRows[i];
    const sideAt = compiled.orderIndex.get(roles.orderSide);
    const qtyAt = compiled.orderIndex.get(roles.orderQuantity);
    if (sideAt === undefined || qtyAt === undefined) return null;
    const raw = cells[qtyAt].trim();
    const quantity = raw ? Number(normalizeNumeric(raw)) : 0;
    if (buyLabels.has(cells[sideAt].trim())) actualBuy += quantity;
    else actualSell += quantity;
  }

  const gaps: string[] = [];
  if (expectedBuy !== null && expectedBuy !== actualBuy) {
    gaps.push(`покупка: заблокировано ${expectedBuy}, в снятие попало ${actualBuy}`);
  }
  if (expectedSell !== null && expectedSell !== actualSell) {
    gaps.push(`продажа: заблокировано ${expectedSell}, в снятие попало ${actualSell}`);
  }
  return gaps.length > 0 ? gaps.join("; ") : null;
}

// -------------------------------------------------------------- генерация

export type GeneratedKind = "cancel" | "cancelStop" | "order";

export interface GeneratedRow {
  kind: GeneratedKind;
  /** Номер строки позиций, с 1. */
  position: number;
  /** Сквозной номер в выводе; null — в вывод не попала. */
  number: number | null;
  text: string | null;
  reason: string | null;
}

export interface GenerateResult {
  plan: Plan;
  rows: GeneratedRow[];
  text: string;
  templateError: string | null;
}

export function generate(input: PlanInput, enabled: readonly boolean[]): GenerateResult {
  const plan = buildPlan(input);
  const empty = { plan, rows: [], text: "", templateError: plan.templateError };
  if (plan.templateError) return empty;

  const { template } = input;
  const compiled = compileTemplate(template);
  if (compiled.error) return { ...empty, templateError: compiled.error };

  const rows: GeneratedRow[] = [];
  const lines: string[] = [];
  let counter = 0;

  const emit = (kind: GeneratedKind, position: number, text: string) => {
    counter += 1;
    lines.push(text);
    rows.push({ kind, position, number: counter, text, reason: null });
  };

  for (const item of plan.positions) {
    const position = item.index + 1;
    const skip = (reason: string) =>
      rows.push({ kind: "order", position, number: null, text: null, reason });

    if (!enabled[item.index]) {
      skip("снята галочка");
      continue;
    }
    if (item.error) {
      skip(item.error);
      continue;
    }

    if (item.skip) {
      skip("нулевая позиция");
      continue;
    }

    const cells = input.rows[item.index];

    // Снятия идут вплотную перед своим закрытием: при разборе отбойника
    // отвергнутое закрытие лежит рядом с заявками, из-за которых отвергнуто.
    for (const i of item.cancels) {
      try {
        emit(
          "cancel",
          position,
          compiled.cancelLine.render(
            createScope(
              template.orderColumns,
              compiled.orderIndex,
              new Map(),
              input.orderRows[i],
              counter + 1,
            ),
          ),
        );
      } catch (error) {
        rows.push({
          kind: "cancel",
          position,
          number: null,
          text: null,
          reason: error instanceof ExpressionError ? error.message : String(error),
        });
      }
    }
    for (const i of item.stopCancels) {
      try {
        emit(
          "cancelStop",
          position,
          compiled.cancelStopLine.render(
            createScope(
              template.stopColumns,
              compiled.stopIndex,
              new Map(),
              input.stopRows[i],
              counter + 1,
            ),
          ),
        );
      } catch (error) {
        rows.push({
          kind: "cancelStop",
          position,
          number: null,
          text: null,
          reason: error instanceof ExpressionError ? error.message : String(error),
        });
      }
    }

    try {
      // Номер строки закрытия известен только сейчас — снятия уже заняли номера.
      emit(
        "order",
        position,
        compiled.line.render(
          createScope(
            template.columns,
            compiled.columnIndex,
            compiled.values,
            cells,
            counter + 1,
            item.market,
          ),
        ),
      );
    } catch (error) {
      skip(error instanceof ExpressionError ? error.message : String(error));
    }
  }

  return { plan, rows, text: lines.join("\n"), templateError: null };
}
