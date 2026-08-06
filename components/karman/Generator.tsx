"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Copy, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible } from "@/components/ticker/Collapsible";
import { TemplateEditor } from "@/components/karman/TemplateEditor";
import { normalizeNumeric } from "@/lib/karman/expression";
import { parseClipboard, parseDate } from "@/lib/karman/parse";
import { generate, type GenerateResult } from "@/lib/karman/generate";
import {
  BUILTIN_TEMPLATES,
  isTemplateModified,
  loadTemplates,
  resetTemplate,
  saveTemplate,
  type Template,
} from "@/lib/karman/template";

const DELIMITER_LABELS: Record<string, string> = {
  "\t": "табуляция",
  ";": "точка с запятой",
};

export function Generator() {
  const [templates, setTemplates] = useState<Template[]>(() =>
    BUILTIN_TEMPLATES.map((item) => structuredClone(item) as Template),
  );
  const [templateId, setTemplateId] = useState(BUILTIN_TEMPLATES[0].id);
  const [editorOpen, setEditorOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [enabled, setEnabled] = useState<boolean[]>([]);
  const [output, setOutput] = useState<GenerateResult | null>(null);
  const [sort, setSort] = useState<{ index: number; dir: "asc" | "desc" } | null>(null);

  // Локальные правки шаблонов читаем только в браузере — на сервере эталон из кода.
  useEffect(() => setTemplates(loadTemplates()), []);

  const template = templates.find((item) => item.id === templateId) ?? templates[0];
  const parsed = useMemo(
    () => (raw.trim() ? parseClipboard(raw, template) : null),
    [raw, template],
  );

  // Новая вставка полностью пересоздаёт предпросмотр: галочки, снятые для
  // прошлой таблицы, не должны молча урезать вывод для новой.
  useEffect(() => {
    setEnabled(parsed ? parsed.rows.map(() => true) : []);
    setSort(null);
    setOutput(null);
  }, [parsed]);

  // Порядок отображения = порядок в выводе: сортировка задаёт последовательность
  // транзакций в кармане, поэтому TRANS_ID нумеруются по видимому порядку.
  const order = useMemo(() => {
    const indexes = parsed ? parsed.rows.map((_, index) => index) : [];
    if (!parsed || !sort) return indexes;

    const column = template.columns[sort.index];
    const sign = sort.dir === "asc" ? 1 : -1;
    return indexes.sort((left, right) => {
      const a = parsed.rows[left][sort.index].trim();
      const b = parsed.rows[right][sort.index].trim();
      if (column.type === "number") {
        return sign * ((a ? Number(normalizeNumeric(a)) : 0) - (b ? Number(normalizeNumeric(b)) : 0));
      }
      if (column.type === "date") {
        return sign * ((parseDate(a)?.getTime() ?? 0) - (parseDate(b)?.getTime() ?? 0));
      }
      return sign * a.localeCompare(b, "ru");
    });
  }, [parsed, sort, template]);

  const cellErrorKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const issue of parsed?.cellErrors ?? []) keys.add(`${issue.row}|${issue.column}`);
    return keys;
  }, [parsed]);

  const blocked = !parsed || parsed.errors.length > 0 || parsed.rows.length === 0;
  const selectedCount = enabled.filter(Boolean).length;

  function updateTemplate(next: Template) {
    setTemplates((current) => current.map((item) => (item.id === next.id ? next : item)));
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Карман транзакций</h1>
        <p className="text-sm text-zinc-500">
          Заявки для загрузки в карман транзакций QUIK по позициям из терминала.
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="template" className="text-sm font-medium">
            Шаблон
          </label>
          <select
            id="template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => setEditorOpen((open) => !open)}>
            <Settings2 /> {editorOpen ? "Свернуть" : "Изменить шаблон"}
          </Button>
          {isTemplateModified(template) && (
            <span className="text-xs text-amber-600 dark:text-amber-400">изменён локально</span>
          )}
        </div>
        <p className="text-sm text-zinc-500">{template.description}</p>

        <Collapsible open={editorOpen}>
          <div className="pt-2">
            <TemplateEditor
              template={template}
              modified={isTemplateModified(template)}
              onChange={updateTemplate}
              onSave={() => {
                saveTemplate(template);
                toast.success("Шаблон сохранён на этой машине");
              }}
              onReset={() => {
                updateTemplate(resetTemplate(template.id));
                toast.success("Шаблон возвращён к исходному");
              }}
            />
          </div>
        </Collapsible>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Вставьте таблицу из QUIK</h2>
        <p className="text-sm text-zinc-500">
          Колонки должны идти в этом порядке:{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {template.columns.map((column) => column.name).join(" · ")}
          </span>
          . Строку заголовков и колонку с номерами строк можно не убирать — они распознаются
          сами. Разделитель — табуляция или «;».
        </p>
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          id="paste"
          placeholder="Ctrl+V"
          className="min-h-40 font-mono text-xs"
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                setRaw(await navigator.clipboard.readText());
              } catch {
                toast.error("Браузер не дал доступ к буферу — вставьте через Ctrl+V");
              }
            }}
          >
            <ClipboardPaste /> Вставить из буфера
          </Button>
          {raw && (
            <Button variant="ghost" size="sm" onClick={() => setRaw("")}>
              Очистить
            </Button>
          )}
        </div>
      </section>

      {parsed && (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {parsed.delimiter && <span>разделитель: {DELIMITER_LABELS[parsed.delimiter]}</span>}
            {parsed.droppedHeader && <span>строка заголовков отброшена</span>}
            {parsed.droppedIndexColumn && <span>колонка нумерации отброшена</span>}
            <span>
              строк: {parsed.rows.length}, отмечено: {selectedCount}
            </span>
          </div>

          {parsed.errors.map((message) => (
            <p
              key={message}
              className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              {message}
            </p>
          ))}

          {parsed.warnings.map((message) => (
            <p
              key={message}
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            >
              {message}
            </p>
          ))}

          {parsed.rows.length > 0 && (
            <div className="max-h-96 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-zinc-100 text-left text-xs dark:bg-zinc-900">
                  <tr>
                    <th className="w-10 p-2" />
                    <th className="w-10 p-2 text-zinc-500">#</th>
                    {template.columns.map((column, columnIndex) => {
                      const active = sort?.index === columnIndex ? sort.dir : null;
                      return (
                        <th
                          key={column.name}
                          className="p-0 font-medium"
                          aria-sort={
                            active === "asc"
                              ? "ascending"
                              : active === "desc"
                                ? "descending"
                                : "none"
                          }
                        >
                          <button
                            type="button"
                            className="flex w-full items-center gap-1 p-2 text-left hover:bg-zinc-200 dark:hover:bg-zinc-800"
                            // Третий клик снимает сортировку — возвращает порядок вставки.
                            onClick={() =>
                              setSort(
                                active === "asc"
                                  ? { index: columnIndex, dir: "desc" }
                                  : active === "desc"
                                    ? null
                                    : { index: columnIndex, dir: "asc" },
                              )
                            }
                          >
                            {column.name}
                            <span className="text-zinc-400">
                              {active === "asc" ? "▲" : active === "desc" ? "▼" : "↕"}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {order.map((index, position) => (
                    <tr key={index} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="p-2">
                        <Checkbox
                          checked={enabled[index] === true}
                          aria-label={`Строка ${position + 1}`}
                          onCheckedChange={(value) =>
                            setEnabled((current) =>
                              current.map((item, i) => (i === index ? value === true : item)),
                            )
                          }
                        />
                      </td>
                      <td className="p-2 text-zinc-500">{position + 1}</td>
                      {template.columns.map((column, columnIndex) => {
                        const broken = cellErrorKeys.has(`${index + 1}|${column.name}`);
                        return (
                          <td
                            key={column.name}
                            className={`p-2 font-mono text-xs ${
                              broken
                                ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                                : ""
                            }`}
                          >
                            {parsed.rows[index][columnIndex]}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Button
            disabled={blocked || selectedCount === 0}
            onClick={() =>
              setOutput(
                generate(
                  template,
                  order.map((index) => parsed.rows[index]),
                  order.map((index) => enabled[index]),
                ),
              )
            }
          >
            Сгенерировать транзакции
          </Button>
        </section>
      )}

      {output && (
        <section className="space-y-2">
          {output.templateError ? (
            <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {output.templateError}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="text-sm font-medium">
                  Транзакции: {output.rows.filter((row) => row.text).length}
                </h2>
                {output.rows.some((row) => row.reason) && (
                  <span className="text-xs text-zinc-500">
                    исключено:{" "}
                    {output.rows
                      .filter((row) => row.reason)
                      .map((row) => `${row.source} (${row.reason})`)
                      .join(", ")}
                  </span>
                )}
              </div>
              <Textarea
                id="output"
                value={output.text}
                readOnly
                className="min-h-48 font-mono text-xs"
                spellCheck={false}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(output.text);
                      toast.success("Транзакции скопированы");
                    } catch {
                      toast.error("Браузер не дал доступ к буферу — выделите текст и Ctrl+C");
                    }
                  }}
                >
                  <Copy /> Копировать в буфер
                </Button>
                <span className="text-xs text-zinc-500">
                  При сохранении в Блокноте выберите кодировку ANSI (Файл → Сохранить как →
                  Кодировка) — QUIK не читает UTF-8.
                </span>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
