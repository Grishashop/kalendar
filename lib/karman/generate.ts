/** Сборка транзакций: разобранные строки позиций + шаблон → текст для кармана. */

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
import { parseDate } from "./parse";
import { ROW_NUMBER_COLUMN, type Template } from "./template";

export interface CompiledTemplate {
  line: CompiledLine;
  skipWhen: CompiledExpression | null;
  /** Именованные выражения — общий источник для текста транзакции и статистики. */
  values: Map<string, CompiledExpression>;
  columnIndex: Map<string, number>;
  error: string | null;
}

const BROKEN: Omit<CompiledTemplate, "error"> = {
  line: compileLine(""),
  skipWhen: null,
  values: new Map(),
  columnIndex: new Map(),
};

export function compileTemplate(template: Template): CompiledTemplate {
  try {
    const values = new Map<string, CompiledExpression>();
    for (const [name, source] of Object.entries(template.values)) {
      values.set(name, compileExpression(source));
    }
    const line = compileLine(template.line);
    const skipWhen = template.skipWhen.trim() ? compileExpression(template.skipWhen) : null;
    const columnIndex = new Map(template.columns.map((column, index) => [column.name, index]));

    const known = new Set([...columnIndex.keys(), ...values.keys(), ROW_NUMBER_COLUMN]);
    const referenced = [
      ...line.columns,
      ...(skipWhen?.columns ?? []),
      ...[...values.values()].flatMap((value) => value.columns),
    ];
    const unknown = [...new Set(referenced.filter((name) => !known.has(name)))];
    if (unknown.length > 0) {
      return {
        ...BROKEN,
        error:
          "В шаблоне используются имена, которых нет ни среди колонок, ни среди " +
          `выражений: ${unknown.map((name) => `«${name}»`).join(", ")}`,
      };
    }

    return { line, skipWhen, values, columnIndex, error: null };
  } catch (error) {
    const message = error instanceof ExpressionError ? error.message : String(error);
    return { ...BROKEN, error: `Ошибка в шаблоне: ${message}` };
  }
}

/**
 * Область видимости одной строки. Имя разрешается сначала как колонка, затем как
 * именованное выражение — колонка всегда сильнее, чтобы данные нельзя было
 * заслонить формулой. Вычисленные значения кешируются на строку.
 */
export function createScope(
  compiled: CompiledTemplate,
  template: Template,
  cells: readonly string[],
  rowNumber: number,
): Scope {
  const cache = new Map<string, Value>();
  const resolving = new Set<string>();

  const scope: Scope = (name) => {
    if (name === ROW_NUMBER_COLUMN) return rowNumber;

    const index = compiled.columnIndex.get(name);
    if (index !== undefined) {
      const column = template.columns[index];
      const raw = cells[index].trim();
      if (column.type === "number") return raw ? Number(normalizeNumeric(raw)) : 0;
      if (column.type === "date") {
        const date = parseDate(raw);
        if (!date) throw new ExpressionError(`не дата: «${raw}»`);
        return date as Value;
      }
      return raw;
    }

    const expression = compiled.values.get(name);
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

export function isSkipped(compiled: CompiledTemplate, scope: Scope): boolean {
  const verdict = compiled.skipWhen?.run(scope);
  return verdict === true || (typeof verdict === "number" && verdict !== 0);
}

export interface GeneratedRow {
  /** Номер строки во вставленной таблице, с 1. */
  source: number;
  /** Сквозной номер в выводе; null — строка в вывод не попала. */
  number: number | null;
  text: string | null;
  reason: string | null;
}

export interface GenerateResult {
  rows: GeneratedRow[];
  text: string;
  /** Ошибка самого шаблона — тогда не сгенерировано ничего. */
  templateError: string | null;
}

export function generate(
  template: Template,
  rows: readonly string[][],
  enabled: readonly boolean[],
): GenerateResult {
  const compiled = compileTemplate(template);
  if (compiled.error) return { rows: [], text: "", templateError: compiled.error };

  const result: GeneratedRow[] = [];
  const lines: string[] = [];
  let counter = 0;

  rows.forEach((cells, rowIndex) => {
    const source = rowIndex + 1;

    if (!enabled[rowIndex]) {
      result.push({ source, number: null, text: null, reason: "снята галочка" });
      return;
    }

    // Номер присваивается только строкам, попавшим в вывод, — нумерация без дыр.
    const scope = createScope(compiled, template, cells, counter + 1);

    try {
      if (isSkipped(compiled, scope)) {
        result.push({ source, number: null, text: null, reason: "нулевая позиция" });
        return;
      }
      const text = compiled.line.render(scope);
      counter += 1;
      lines.push(text);
      result.push({ source, number: counter, text, reason: null });
    } catch (error) {
      const message = error instanceof ExpressionError ? error.message : String(error);
      result.push({ source, number: null, text: null, reason: message });
    }
  });

  return { rows: result, text: lines.join("\n"), templateError: null };
}
