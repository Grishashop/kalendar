/**
 * Разбор таблицы, вставленной из QUIK.
 *
 * Колонки определяются позицией, а не именами: заголовки у разных пользователей
 * выводятся на русском или на английском
 * (см. docs/adr/0002-pozicionnyj-razbor-vstavki.md). Отсюда же требование к
 * защите: позиционный разбор при сдвиге колонок портит данные молча, поэтому
 * несовпадение типов блокирует генерацию, а не предупреждает.
 */

import { normalizeNumeric } from "./expression";
import type { Template, TemplateColumn } from "./template";

export type Delimiter = "\t" | ";";

export interface CellIssue {
  /** Номер строки данных, с 1. */
  row: number;
  column: string;
  message: string;
}

export interface ParseResult {
  delimiter: Delimiter | null;
  droppedHeader: boolean;
  droppedIndexColumn: boolean;
  rows: string[][];
  /** Блокируют генерацию. */
  errors: string[];
  cellErrors: CellIssue[];
  /** Не блокируют генерацию. */
  warnings: string[];
}

const EMPTY_RESULT: Omit<ParseResult, "errors"> = {
  delimiter: null,
  droppedHeader: false,
  droppedIndexColumn: false,
  rows: [],
  cellErrors: [],
  warnings: [],
};

/** Даты QUIK приходят как `19.03.2026`, из Excel — как `19/3/26`; ISO принимаем тоже. */
export function parseDate(raw: string): Date | null {
  const value = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(value);
  if (!dmy) return null;

  const day = Number(dmy[1]);
  const month = Number(dmy[2]);
  const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  // Отсекаем 31.02 и прочее, что Date молча переносит на следующий месяц.
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** Сообщение о непригодности ячейки, либо null. */
export function checkCell(raw: string, column: TemplateColumn): string | null {
  const value = raw.trim();

  if (!value) {
    return column.nullable ? null : "пусто";
  }

  if (column.type === "number") {
    const num = Number(normalizeNumeric(value));
    if (!Number.isFinite(num)) return `ожидалось число, а тут «${value}»`;
  } else if (column.type === "date") {
    if (!parseDate(value)) return `ожидалась дата, а тут «${value}»`;
  }

  if (column.pattern && !new RegExp(column.pattern).test(value)) {
    return `«${value}» не подходит под ожидаемый вид колонки`;
  }

  return null;
}

/** Колонка подписей строк QUIK: значения идут 1, 2, 3 … (шапка, если есть, пустая). */
function looksLikeIndexColumn(rows: string[][]): boolean {
  const values = rows.map((row) => row[0].trim());
  const start = /^\d+$/.test(values[0]) ? 0 : 1;
  if (values.length - start < 2) return false;
  return values.slice(start).every((value, offset) => value === String(offset + 1));
}

export function parseClipboard(text: string, template: Template): ParseResult {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return { ...EMPTY_RESULT, errors: ["Пусто — вставьте таблицу из QUIK."] };
  }

  const expected = template.columns.length;

  // Буфер обмена умеет обрезать хвостовые пустые поля построчно, поэтому
  // одинаковая ширина строк — не требование, а лишь признак хорошего кандидата.
  const candidates = (["\t", ";"] as const)
    .map((delimiter) => {
      const split = lines.map((line) => line.split(delimiter));
      const width = Math.max(...split.map((row) => row.length));
      return {
        delimiter,
        width,
        ragged: split.filter((row) => row.length !== width).length,
        rows: split.map((row) => [...row, ...Array(width - row.length).fill("")]),
      };
    })
    .filter((candidate) => candidate.width > 1)
    .sort(
      (a, b) =>
        Math.abs(a.width - expected) - Math.abs(b.width - expected) ||
        a.ragged - b.ragged ||
        (a.delimiter === "\t" ? -1 : 1),
    );

  if (candidates.length === 0) {
    return {
      ...EMPTY_RESULT,
      errors: [
        "Не удалось определить разделитель. Ожидается таблица, разделённая " +
          "табуляцией или «;».",
      ],
    };
  }

  const chosen = candidates[0];
  let rows = chosen.rows;

  // Колонка нумерации распознаётся раньше подгонки ширины: если сначала
  // добить пустые хвосты, она въедет в «Торговый счет» и всё поедет молча.
  // Значения 1..N не могут быть настоящей первой колонкой, если та не числовая.
  const droppedIndexColumn =
    rows[0].length > 1 && template.columns[0].type !== "number" && looksLikeIndexColumn(rows);
  if (droppedIndexColumn) rows = rows.map((row) => row.slice(1));

  // Лишние хвостовые колонки бывают только фантомными — от завершающей «;».
  while (rows[0].length > expected && rows.every((row) => row[row.length - 1].trim() === "")) {
    rows = rows.map((row) => row.slice(0, -1));
  }

  // Обрезанные буфером хвосты восстанавливаем — но только если недостающие
  // колонки объявлены допускающими пустоту. Иначе это не обрезка, а другой состав.
  if (
    rows[0].length < expected &&
    template.columns.slice(rows[0].length).every((column) => column.nullable === true)
  ) {
    rows = rows.map((row) => [...row, ...Array(expected - row.length).fill("")]);
  }

  if (rows[0].length !== expected) {
    return {
      ...EMPTY_RESULT,
      delimiter: chosen.delimiter,
      droppedIndexColumn,
      errors: [
        `Ожидалось ${expected} колонок, получено ${rows[0].length}. ` +
          "Проверьте состав и порядок колонок в QUIK.",
      ],
    };
  }

  const rowIsValid = (row: string[]) =>
    template.columns.every((column, index) => checkCell(row[index], column) === null);

  // Строка заголовков распознаётся структурно: имена не проходят типовую
  // проверку, а данные проходят. Это работает и для русской, и для английской шапки.
  let droppedHeader = false;
  if (rows.length > 1 && !rowIsValid(rows[0]) && rows.slice(1).every(rowIsValid)) {
    rows = rows.slice(1);
    droppedHeader = true;
  }

  const cellErrors: CellIssue[] = [];
  rows.forEach((row, rowIndex) => {
    template.columns.forEach((column, columnIndex) => {
      const message = checkCell(row[columnIndex], column);
      if (message) cellErrors.push({ row: rowIndex + 1, column: column.name, message });
    });
  });

  const errors: string[] = [];
  if (cellErrors.length > 0) {
    errors.push(
      `Данные не сходятся с ожидаемыми колонками — не прошло проверку ячеек: ` +
        `${cellErrors.length}. Похоже на сдвиг колонок, неверный порядок или не тот ` +
        "разделитель. Проверьте порядок колонок в QUIK и вставьте заново.",
    );
  }

  const warnings: string[] = [];
  for (const name of template.warnUniform) {
    const index = template.columns.findIndex((column) => column.name === name);
    if (index === -1) continue;
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = row[index].trim();
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    if (counts.size > 1) {
      const summary = [...counts]
        .map(([value, count]) => `${value} — ${count}`)
        .join(", ");
      warnings.push(`Разные значения в колонке «${name}»: ${summary}. Фильтр в QUIK наложен?`);
    }
  }

  for (const name of template.warnEmpty) {
    const index = template.columns.findIndex((column) => column.name === name);
    if (index === -1) continue;
    const filled = rows
      .map((row, rowIndex) => (row[index].trim() ? rowIndex + 1 : 0))
      .filter(Boolean);
    if (filled.length > 0) {
      warnings.push(
        `Колонка «${name}» заполнена в ${filled.length} строках (№ ${filled.join(", ")}). ` +
          "Фильтр по активным заявкам в QUIK наложен?",
      );
    }
  }

  return {
    delimiter: chosen.delimiter,
    droppedHeader,
    droppedIndexColumn,
    rows,
    errors,
    cellErrors,
    warnings,
  };
}
