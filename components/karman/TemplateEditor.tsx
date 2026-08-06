"use client";

import { useMemo } from "react";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { compileExpression, compileLine, ExpressionError } from "@/lib/karman/expression";
import {
  ROW_NUMBER_COLUMN,
  type ColumnType,
  type Template,
  type TemplateStats,
} from "@/lib/karman/template";

const TYPE_LABELS: Record<ColumnType, string> = {
  number: "Число",
  text: "Текст",
  date: "Дата",
};

const STATS_FIELDS = [
  ["quantity", "Количество в заявке"],
  ["direction", "Направление"],
  ["instrument", "Инструмент"],
  ["account", "Торговый счёт"],
] as const satisfies readonly (readonly [keyof TemplateStats, string])[];

function problem(source: string, compile: (src: string) => unknown): string | null {
  if (!source.trim()) return null;
  try {
    compile(source);
    return null;
  } catch (error) {
    return error instanceof ExpressionError ? error.message : String(error);
  }
}

export function TemplateEditor({
  template,
  modified,
  onChange,
  onSave,
  onReset,
}: {
  template: Template;
  modified: boolean;
  onChange: (next: Template) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const lineError = useMemo(() => problem(template.line, compileLine), [template.line]);
  const skipError = useMemo(
    () => problem(template.skipWhen, compileExpression),
    [template.skipWhen],
  );

  function patchColumn(index: number, patch: Partial<Template["columns"][number]>) {
    const columns = template.columns.map((column, i) =>
      i === index ? { ...column, ...patch } : column,
    );
    onChange({ ...template, columns });
  }

  return (
    <div className="space-y-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Колонки — в том порядке, в каком они идут в QUIK</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="w-8 pb-1">#</th>
                <th className="pb-1">Имя</th>
                <th className="w-28 pb-1">Тип</th>
                <th className="pb-1">Регулярка</th>
                <th className="w-24 pb-1">Пустая</th>
                <th className="w-28 pb-1">Сорт. по модулю</th>
                <th className="w-8 pb-1" />
              </tr>
            </thead>
            <tbody>
              {template.columns.map((column, index) => (
                <tr key={index} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-1 text-zinc-500">{index + 1}</td>
                  <td className="py-1 pr-2">
                    <Input
                      value={column.name}
                      onChange={(e) => patchColumn(index, { name: e.target.value })}
                      className="h-8"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      value={column.type}
                      onChange={(e) => patchColumn(index, { type: e.target.value as ColumnType })}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {Object.entries(TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      value={column.pattern ?? ""}
                      placeholder="необязательно"
                      onChange={(e) => patchColumn(index, { pattern: e.target.value || undefined })}
                      className="h-8 font-mono text-xs"
                    />
                  </td>
                  <td className="py-1">
                    <Checkbox
                      checked={column.nullable === true}
                      onCheckedChange={(value) => patchColumn(index, { nullable: value === true })}
                    />
                  </td>
                  <td className="py-1">
                    <Checkbox
                      checked={column.sortByAbs === true}
                      disabled={column.type !== "number"}
                      aria-label={`Сортировать «${column.name}» по модулю`}
                      onCheckedChange={(value) => patchColumn(index, { sortByAbs: value === true })}
                    />
                  </td>
                  <td className="py-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Удалить колонку ${column.name}`}
                      onClick={() =>
                        onChange({
                          ...template,
                          columns: template.columns.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({
              ...template,
              columns: [...template.columns, { name: "Новая колонка", type: "text" }],
            })
          }
        >
          <Plus /> Добавить колонку
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Именованные выражения</h3>
        <p className="text-xs text-zinc-500">
          Считаются один раз на строку, ссылка на них выглядит как ссылка на колонку:{" "}
          <code>[Количество]</code>. Нужны, чтобы одно правило не копировалось между текстом
          транзакции, отсевом и сводкой.
        </p>
        {Object.entries(template.values).map(([name, source], index) => (
          <div key={index} className="flex gap-2">
            <Input
              value={name}
              aria-label="Имя выражения"
              onChange={(e) =>
                onChange({
                  ...template,
                  values: Object.fromEntries(
                    Object.entries(template.values).map(([key, value], i) =>
                      i === index ? [e.target.value, value] : [key, value],
                    ),
                  ),
                })
              }
              className="h-8 w-48 shrink-0"
            />
            <Input
              value={source}
              aria-label={`Выражение ${name}`}
              onChange={(e) =>
                onChange({ ...template, values: { ...template.values, [name]: e.target.value } })
              }
              className="h-8 font-mono text-xs"
              spellCheck={false}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={`Удалить выражение ${name}`}
              onClick={() =>
                onChange({
                  ...template,
                  values: Object.fromEntries(
                    Object.entries(template.values).filter(([key]) => key !== name),
                  ),
                })
              }
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {Object.entries(template.values).map(([name, source]) => {
          const error = problem(source, compileExpression);
          return error ? (
            <p key={name} className="text-xs text-red-600 dark:text-red-400">
              {name}: {error}
            </p>
          ) : null;
        })}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({ ...template, values: { ...template.values, "Новое выражение": "0" } })
          }
        >
          <Plus /> Добавить выражение
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Текст транзакции</h3>
        <p className="text-xs text-zinc-500">
          Выражения — в <code>${"{...}"}</code>, колонки — в квадратных скобках. Доступны:{" "}
          {[
            ROW_NUMBER_COLUMN,
            ...template.columns.map((c) => c.name),
            ...Object.keys(template.values),
          ]
            .map((name) => `[${name}]`)
            .join(", ")}
          . Функции: IF, ABS, ROUND, INT, MAX, MIN, TEXT, TODAY. Разделитель аргументов — «;».
        </p>
        <Textarea
          value={template.line}
          onChange={(e) => onChange({ ...template, line: e.target.value })}
          className="min-h-32 font-mono text-xs"
          spellCheck={false}
        />
        {lineError && <p className="text-xs text-red-600 dark:text-red-400">{lineError}</p>}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Правило отсева строк</h3>
        <p className="text-xs text-zinc-500">
          Строка не попадает в вывод, если выражение истинно. Пусто — не отсеивать ничего.
        </p>
        <Input
          value={template.skipWhen}
          onChange={(e) => onChange({ ...template, skipWhen: e.target.value })}
          className="font-mono text-xs"
          spellCheck={false}
        />
        {skipError && <p className="text-xs text-red-600 dark:text-red-400">{skipError}</p>}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Сводка перед отправкой</h3>
        <p className="text-xs text-zinc-500">
          Имя колонки или именованного выражения, откуда сводка берёт каждую величину.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {STATS_FIELDS.map(([key, label]) => (
            <label key={key} className="block text-xs text-zinc-500">
              {label}
              <Input
                value={template.stats[key]}
                onChange={(e) =>
                  onChange({ ...template, stats: { ...template.stats, [key]: e.target.value } })
                }
                className="mt-1 text-sm"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Предупреждения о выборке</h3>
        <p className="text-xs text-zinc-500">
          Имена колонок через запятую. Предупреждение не блокирует генерацию.
        </p>
        <label className="block text-xs text-zinc-500">
          Значение обязано быть одинаковым во всех строках
          <Input
            value={template.warnUniform.join(", ")}
            onChange={(e) =>
              onChange({
                ...template,
                warnUniform: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })
            }
            className="mt-1 text-sm"
          />
        </label>
        <label className="block text-xs text-zinc-500">
          Колонка обязана быть пустой во всех строках
          <Input
            value={template.warnEmpty.join(", ")}
            onChange={(e) =>
              onChange({
                ...template,
                warnEmpty: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })
            }
            className="mt-1 text-sm"
          />
        </label>
      </section>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={lineError !== null || skipError !== null}>
          <Save /> Сохранить
        </Button>
        <Button variant="outline" size="sm" onClick={onReset} disabled={!modified}>
          <RotateCcw /> Сбросить к исходному
        </Button>
        {modified && <span className="text-xs text-amber-600 dark:text-amber-400">изменён</span>}
      </div>
    </div>
  );
}
