"use client";

import { useMemo, useState } from "react";
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
  type TemplateColumn,
  type TemplateRoles,
} from "@/lib/karman/template";

const TYPE_LABELS: Record<ColumnType, string> = {
  number: "Число",
  text: "Текст",
  date: "Дата",
};

/**
 * Псевдоколонки рыночных данных: их подставляет генератор из стакана, во
 * вставке их нет. Список продублирован из генератора намеренно — здесь он
 * нужен только как подсказка оператору и не должен тянуть за собой код
 * генерации в клиентский бандл редактора.
 */
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
] as const;

interface RoleGroup {
  title: string;
  hint: string;
  /** Роли, значение которых — имя колонки или именованного выражения. */
  columnFields: readonly (readonly [keyof TemplateRoles, string])[];
  /** Роли, значение которых — сам текст в ячейке, а не имя колонки. */
  valueFields: readonly (readonly [keyof TemplateRoles, string, string])[];
}

const ROLE_GROUPS: readonly RoleGroup[] = [
  {
    title: "Позиции",
    hint: "Имя колонки основной вставки или именованного выражения.",
    columnFields: [
      ["quantity", "Количество в заявке (число)"],
      ["direction", "Направление заявки (текст)"],
      ["instrument", "Инструмент"],
      ["account", "Торговый счёт"],
      ["maturity", "Дата погашения — сверяется со справочником биржи"],
      ["activeBuy", "Объём активных заявок на покупку"],
      ["activeSell", "Объём активных заявок на продажу"],
    ],
    valueFields: [],
  },
  {
    title: "Активные заявки",
    hint: "Имя колонки вставки активных заявок. По счёту и инструменту заявка привязывается к позиции.",
    columnFields: [
      ["orderAccount", "Торговый счёт"],
      ["orderInstrument", "Инструмент"],
      ["orderSide", "Сторона заявки"],
      ["orderQuantity", "Объём заявки"],
    ],
    valueFields: [
      [
        "orderBuyLabel",
        "Содержимое ячейки стороны, означающее покупку (не имя колонки)",
        "Покупка",
      ],
    ],
  },
  {
    title: "Стоп-заявки",
    hint: "Имя колонки вставки стоп-заявок. Сверить объём не с чем — только привязка к позиции.",
    columnFields: [
      ["stopAccount", "Торговый счёт"],
      ["stopInstrument", "Инструмент"],
    ],
    valueFields: [],
  },
];

function problem(source: string, compile: (src: string) => unknown): string | null {
  if (!source.trim()) return null;
  try {
    compile(source);
    return null;
  } catch (error) {
    return error instanceof ExpressionError ? error.message : String(error);
  }
}

/** Одинаковая таблица нужна трём вставкам: позициям, заявкам и стоп-заявкам. */
function ColumnsTable({
  title,
  columns,
  onChange,
}: {
  title: string;
  columns: TemplateColumn[];
  onChange: (next: TemplateColumn[]) => void;
}) {
  function patch(index: number, values: Partial<TemplateColumn>) {
    onChange(columns.map((column, i) => (i === index ? { ...column, ...values } : column)));
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-xs text-zinc-500">
        Порядок строк обязан совпадать с порядком колонок в QUIK.
      </p>
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
            {columns.map((column, index) => (
              <tr key={index} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="py-1 text-zinc-500">{index + 1}</td>
                <td className="py-1 pr-2">
                  <Input
                    value={column.name}
                    aria-label={`Имя колонки ${index + 1}`}
                    onChange={(e) => patch(index, { name: e.target.value })}
                    className="h-8"
                  />
                </td>
                <td className="py-1 pr-2">
                  <select
                    value={column.type}
                    aria-label={`Тип колонки «${column.name}»`}
                    onChange={(e) => patch(index, { type: e.target.value as ColumnType })}
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
                    aria-label={`Регулярка колонки «${column.name}»`}
                    onChange={(e) => patch(index, { pattern: e.target.value || undefined })}
                    className="h-8 font-mono text-xs"
                  />
                </td>
                <td className="py-1">
                  <Checkbox
                    checked={column.nullable === true}
                    aria-label={`Колонка «${column.name}» бывает пустой`}
                    onCheckedChange={(value) => patch(index, { nullable: value === true })}
                  />
                </td>
                <td className="py-1">
                  <Checkbox
                    checked={column.sortByAbs === true}
                    disabled={column.type !== "number"}
                    aria-label={`Сортировать «${column.name}» по модулю`}
                    onCheckedChange={(value) => patch(index, { sortByAbs: value === true })}
                  />
                </td>
                <td className="py-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Удалить колонку ${column.name}`}
                    onClick={() => onChange(columns.filter((_, i) => i !== index))}
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
        onClick={() => onChange([...columns, { name: "Новая колонка", type: "text" }])}
      >
        <Plus /> Добавить колонку
      </Button>
    </section>
  );
}

/**
 * Числовое поле с черновиком: пока оператор стирает значение и набирает его
 * заново, в поле побывает и пустая строка, и «0.». Такой промежуточный текст
 * нельзя класть в шаблон — NaN оттуда ушёл бы прямо в расчёт цены заявки.
 */
function NumberField({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <label className="block text-xs text-zinc-500">
      {label}
      <Input
        type="number"
        min={min}
        step={step}
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(parsed)) onChange(parsed);
        }}
        onBlur={() => setDraft(null)}
        className="mt-1 text-sm"
      />
    </label>
  );
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
  const cancelError = useMemo(
    () => problem(template.cancelLine, compileLine),
    [template.cancelLine],
  );
  const cancelStopError = useMemo(
    () => problem(template.cancelStopLine, compileLine),
    [template.cancelStopLine],
  );
  const skipError = useMemo(
    () => problem(template.skipWhen, compileExpression),
    [template.skipWhen],
  );
  const valueErrors = useMemo(
    () =>
      Object.entries(template.values)
        .map(([name, source]) => [name, problem(source, compileExpression)] as const)
        .filter(([, error]) => error !== null),
    [template.values],
  );

  // Сохранять шаблон, который заведомо не соберётся, незачем: ошибка всплыла бы
  // уже на генерации, когда исходный текст правки потерян.
  const broken =
    lineError !== null ||
    cancelError !== null ||
    cancelStopError !== null ||
    skipError !== null ||
    valueErrors.length > 0;

  const lineNames = [
    ROW_NUMBER_COLUMN,
    ...template.columns.map((c) => c.name),
    ...Object.keys(template.values),
    ...MARKET_COLUMNS,
  ];
  const cancelNames = [ROW_NUMBER_COLUMN, ...template.orderColumns.map((c) => c.name)];
  const cancelStopNames = [ROW_NUMBER_COLUMN, ...template.stopColumns.map((c) => c.name)];

  return (
    <div className="space-y-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <ColumnsTable
        title="Колонки позиций"
        columns={template.columns}
        onChange={(columns) => onChange({ ...template, columns })}
      />

      <ColumnsTable
        title="Колонки активных заявок"
        columns={template.orderColumns}
        onChange={(orderColumns) => onChange({ ...template, orderColumns })}
      />

      <ColumnsTable
        title="Колонки стоп-заявок"
        columns={template.stopColumns}
        onChange={(stopColumns) => onChange({ ...template, stopColumns })}
      />

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
        {valueErrors.map(([name, error]) => (
          <p key={name} className="text-xs text-red-600 dark:text-red-400">
            {name}: {error}
          </p>
        ))}
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
          {lineNames.map((name) => `[${name}]`).join(", ")}. Функции: IF, ABS, ROUND, INT, MAX, MIN,
          TEXT, TODAY. Разделитель аргументов — «;».
        </p>
        <Textarea
          value={template.line}
          aria-label="Текст транзакции на ввод заявки"
          onChange={(e) => onChange({ ...template, line: e.target.value })}
          className="min-h-32 font-mono text-xs"
          spellCheck={false}
        />
        {lineError && <p className="text-xs text-red-600 dark:text-red-400">{lineError}</p>}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Снятие обычной заявки</h3>
        <p className="text-xs text-zinc-500">
          Строка считается по вставке активных заявок, поэтому колонки позиций и именованные
          выражения здесь недоступны. Доступны:{" "}
          {cancelNames.map((name) => `[${name}]`).join(", ")}.
        </p>
        <Textarea
          value={template.cancelLine}
          aria-label="Текст транзакции на снятие обычной заявки"
          onChange={(e) => onChange({ ...template, cancelLine: e.target.value })}
          className="min-h-20 font-mono text-xs"
          spellCheck={false}
        />
        {cancelError && <p className="text-xs text-red-600 dark:text-red-400">{cancelError}</p>}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Снятие стоп-заявки</h3>
        <p className="text-xs text-zinc-500">
          Строка считается по вставке стоп-заявок, поэтому колонки позиций и именованные выражения
          здесь недоступны. Доступны: {cancelStopNames.map((name) => `[${name}]`).join(", ")}.
        </p>
        <Textarea
          value={template.cancelStopLine}
          aria-label="Текст транзакции на снятие стоп-заявки"
          onChange={(e) => onChange({ ...template, cancelStopLine: e.target.value })}
          className="min-h-20 font-mono text-xs"
          spellCheck={false}
        />
        {cancelStopError && (
          <p className="text-xs text-red-600 dark:text-red-400">{cancelStopError}</p>
        )}
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

      <section className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Роли колонок</h3>
          <p className="text-xs text-zinc-500">
            По этим именам код находит нужные величины: сводка, сверки со справочником биржи и
            сопоставление вставок между собой.
          </p>
        </div>
        {ROLE_GROUPS.map((group) => (
          <div key={group.title} className="space-y-2">
            <h4 className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{group.title}</h4>
            <p className="text-xs text-zinc-500">{group.hint}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.columnFields.map(([key, label]) => (
                <label key={key} className="block text-xs text-zinc-500">
                  {label}
                  <Input
                    value={template.roles[key]}
                    onChange={(e) =>
                      onChange({ ...template, roles: { ...template.roles, [key]: e.target.value } })
                    }
                    className="mt-1 text-sm"
                  />
                </label>
              ))}
              {group.valueFields.map(([key, label, placeholder]) => (
                <label key={key} className="block text-xs text-zinc-500">
                  {label}
                  <Input
                    value={template.roles[key]}
                    placeholder={placeholder}
                    onChange={(e) =>
                      onChange({ ...template, roles: { ...template.roles, [key]: e.target.value } })
                    }
                    className="mt-1 text-sm"
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Ценообразование</h3>
        <p className="text-xs text-zinc-500">
          Спред здесь — только начальное значение: перед генерацией он правится на самой странице,
          и правка страницы в шаблон не возвращается.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <NumberField
            label="Спред на проскальзывание по умолчанию, %"
            value={template.pricing.spreadPercent}
            min={0}
            step={0.1}
            onChange={(spreadPercent) =>
              onChange({ ...template, pricing: { ...template.pricing, spreadPercent } })
            }
          />
          <NumberField
            label="Предельный возраст котировки, с — старше уходит рыночной"
            value={template.pricing.freshnessSec}
            min={0}
            step={1}
            onChange={(freshnessSec) =>
              onChange({ ...template, pricing: { ...template.pricing, freshnessSec } })
            }
          />
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
        <Button size="sm" onClick={onSave} disabled={broken}>
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
