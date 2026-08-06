/** Сборка транзакций: разобранные строки позиций + шаблон → текст для кармана. */

import {
  compileExpression,
  compileLine,
  ExpressionError,
  normalizeNumeric,
  type Scope,
  type Value,
} from "./expression";
import { parseDate } from "./parse";
import { ROW_NUMBER_COLUMN, type Template } from "./template";

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
  let line;
  let skipWhen;
  try {
    line = compileLine(template.line);
    skipWhen = template.skipWhen.trim() ? compileExpression(template.skipWhen) : null;
  } catch (error) {
    const message = error instanceof ExpressionError ? error.message : String(error);
    return { rows: [], text: "", templateError: `Ошибка в шаблоне: ${message}` };
  }

  const known = new Set(template.columns.map((column) => column.name));
  known.add(ROW_NUMBER_COLUMN);
  const unknown = [...line.columns, ...(skipWhen?.columns ?? [])].filter(
    (column) => !known.has(column),
  );
  if (unknown.length > 0) {
    return {
      rows: [],
      text: "",
      templateError:
        `В шаблоне используются колонки, которых нет в объявлении: ` +
        unknown.map((name) => `«${name}»`).join(", "),
    };
  }

  const indexByName = new Map(template.columns.map((column, index) => [column.name, index]));

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
    const scope: Scope = (name) => {
      if (name === ROW_NUMBER_COLUMN) return counter + 1;
      const index = indexByName.get(name);
      if (index === undefined) throw new ExpressionError(`нет колонки «${name}»`);
      const column = template.columns[index];
      const raw = cells[index].trim();
      if (column.type === "number") return raw ? Number(normalizeNumeric(raw)) : 0;
      if (column.type === "date") {
        const date = parseDate(raw);
        if (!date) throw new ExpressionError(`не дата: «${raw}»`);
        return date as Value;
      }
      return raw;
    };

    try {
      const verdict = skipWhen?.run(scope);
      if (verdict === true || (typeof verdict === "number" && verdict !== 0)) {
        result.push({ source, number: null, text: null, reason: "нулевая позиция" });
        return;
      }
      const text = line.render(scope);
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
