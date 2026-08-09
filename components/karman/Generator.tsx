"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Copy, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible } from "@/components/ticker/Collapsible";
import { TemplateEditor } from "@/components/karman/TemplateEditor";
import { normalizeNumeric } from "@/lib/karman/expression";
import { parseClipboard, parseDate, type ParseResult } from "@/lib/karman/parse";
import { buildPlan, generate, type MarketRow, type GenerateResult } from "@/lib/karman/generate";
import type { CheckVerdict } from "@/lib/karman/checks";
import { loadContracts, loadQuotes } from "@/lib/karman/market";
import type { ContractInfo } from "@/lib/karman/contracts";
import type { OrderMode, Quote } from "@/lib/karman/pricing";
import { computeStats, type Stats } from "@/lib/karman/stats";
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

const VERDICT_LABELS: Record<string, string> = {
  ok: "",
  unchecked: "—",
  deliveryUnknown: "не проверен",
  unknown: "нет в справочнике",
  notDeliverable: "расчётный",
  notNearest: "не ближайшая",
  maturityMismatch: "дата не сходится",
};

/**
 * Вердикты, снимающие галочку. «Не проверен» сюда не входит: незнание не повод
 * исключить строку — исключённая позиция уедет на поставку.
 */
const BLOCKING_VERDICTS = new Set<CheckVerdict>([
  "unknown",
  "notDeliverable",
  "notNearest",
  "maturityMismatch",
]);

const ORDER = ["заявка", "заявки", "заявок"] as const;
const CONTRACT = ["контракт", "контракта", "контрактов"] as const;
const INSTRUMENT = ["инструмент", "инструмента", "инструментов"] as const;
const ACCOUNT = ["счёт", "счёта", "счетов"] as const;
const ROW = ["строка", "строки", "строк"] as const;

/** Русское согласование: 1 заявка, 2 заявки, 5 заявок, 11 заявок, 21 заявка. */
function plural(count: number, forms: readonly [string, string, string]): string {
  const tail = Math.abs(count) % 100;
  if (tail >= 11 && tail <= 14) return forms[2];
  const last = tail % 10;
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

const EMPTY_PARSE: ParseResult = {
  delimiter: null,
  droppedHeader: false,
  droppedIndexColumn: false,
  rows: [],
  errors: [],
  cellErrors: [],
  warnings: [],
};

export function Generator() {
  const [templates, setTemplates] = useState<Template[]>(() =>
    BUILTIN_TEMPLATES.map((item) => structuredClone(item) as Template),
  );
  const [templateId, setTemplateId] = useState(BUILTIN_TEMPLATES[0].id);
  const [editorOpen, setEditorOpen] = useState(false);

  const [raw, setRaw] = useState("");
  const [orderRaw, setOrderRaw] = useState("");
  const [stopRaw, setStopRaw] = useState("");
  const [cancelOrders, setCancelOrders] = useState(false);
  const [cancelStops, setCancelStops] = useState(false);

  const [mode, setMode] = useState<OrderMode>("market");
  const [spread, setSpread] = useState(BUILTIN_TEMPLATES[0].pricing.spreadPercent);
  const [contracts, setContracts] = useState<Record<string, ContractInfo | null>>({});
  const [contractsLoaded, setContractsLoaded] = useState(false);
  const [contractsError, setContractsError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [quotesAt, setQuotesAt] = useState<number | null>(null);
  const [loadingMarket, setLoadingMarket] = useState(false);

  const [enabled, setEnabled] = useState<boolean[]>([]);
  const [sort, setSort] = useState<{ index: number; dir: "asc" | "desc" } | null>(null);
  const [output, setOutput] = useState<GenerateResult | null>(null);

  // Локальные правки шаблонов читаем только в браузере — на сервере эталон из кода.
  useEffect(() => setTemplates(loadTemplates()), []);

  const template = templates.find((item) => item.id === templateId) ?? templates[0];

  const parsed = useMemo(
    () => (raw.trim() ? parseClipboard(raw, template) : null),
    [raw, template],
  );
  const parsedOrders = useMemo(
    () =>
      orderRaw.trim()
        ? parseClipboard(orderRaw, {
            columns: template.orderColumns,
            warnUniform: [],
            warnEmpty: [],
          })
        : EMPTY_PARSE,
    [orderRaw, template],
  );
  const parsedStops = useMemo(
    () =>
      stopRaw.trim()
        ? parseClipboard(stopRaw, { columns: template.stopColumns, warnUniform: [], warnEmpty: [] })
        : EMPTY_PARSE,
    [stopRaw, template],
  );

  /** Уникальные коды инструментов вставки — по ним тянем справочник и котировки. */
  const instruments = useMemo(() => {
    if (!parsed) return [];
    const at = template.columns.findIndex((column) => column.name === template.roles.instrument);
    if (at === -1) return [];
    return [...new Set(parsed.rows.map((cells) => cells[at].trim()).filter(Boolean))].sort();
  }, [parsed, template]);

  const refreshMarket = useCallback(
    async (secids: readonly string[]) => {
      if (secids.length === 0) return;
      setLoadingMarket(true);
      const [reference, quote] = await Promise.all([loadContracts(secids), loadQuotes(secids)]);
      setContracts(reference.contracts);
      setContractsLoaded(reference.loaded);
      setContractsError(reference.error);
      setQuotes(quote.quotes);
      setQuotesError(quote.error);
      setQuotesAt(quote.loaded ? quote.at : null);
      setLoadingMarket(false);
    },
    [],
  );

  // Разобрали таблицу — цены нужны сразу: вставка позиций и есть намерение их получить.
  const instrumentKey = instruments.join(",");
  useEffect(() => {
    void refreshMarket(instrumentKey ? instrumentKey.split(",") : []);
  }, [instrumentKey, refreshMarket]);

  const market = useMemo(() => {
    const result: Record<string, MarketRow> = {};
    for (const secid of instruments) {
      result[secid] = { contract: contracts[secid] ?? null, quote: quotes[secid] ?? null };
    }
    return result;
  }, [instruments, contracts, quotes]);

  const plan = useMemo(
    () =>
      parsed
        ? buildPlan({
            template,
            rows: parsed.rows,
            orderRows: cancelOrders ? parsedOrders.rows : [],
            stopRows: cancelStops ? parsedStops.rows : [],
            market,
            contractsLoaded,
            mode,
            spreadPercent: spread,
            cancelOrders,
            cancelStops,
          })
        : null,
    [
      parsed,
      template,
      parsedOrders,
      parsedStops,
      market,
      contractsLoaded,
      mode,
      spread,
      cancelOrders,
      cancelStops,
    ],
  );

  // Галочка снимается автоматически со строк, не прошедших проверку контракта
  // (docs/adr/0006). Зависимость — только вердикты: смена спреда или режима
  // не должна сбрасывать снятые вручную галочки.
  const verdicts = plan?.positions.map((item) => item.check.verdict).join("|") ?? "";
  useEffect(() => {
    if (!plan) {
      setEnabled([]);
      setSort(null);
      setOutput(null);
      return;
    }
    setEnabled(
      plan.positions.map(
        (item) => !BLOCKING_VERDICTS.has(item.check.verdict),
      ),
    );
    setSort(null);
    setOutput(null);
    // plan намеренно не в зависимостях: он пересчитывается на каждое изменение
    // спреда, а галочки от спреда не зависят.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, verdicts]);

  useEffect(() => setOutput(null), [mode, spread, cancelOrders, cancelStops, enabled]);

  const order = useMemo(() => {
    const indexes = parsed ? parsed.rows.map((_, index) => index) : [];
    if (!parsed || !sort) return indexes;

    const column = template.columns[sort.index];
    const sign = sort.dir === "asc" ? 1 : -1;
    return indexes.sort((left, right) => {
      const a = parsed.rows[left][sort.index].trim();
      const b = parsed.rows[right][sort.index].trim();
      if (column.type === "number") {
        const toNumber = (rawCell: string) => {
          const value = rawCell ? Number(normalizeNumeric(rawCell)) : 0;
          return column.sortByAbs ? Math.abs(value) : value;
        };
        return sign * (toNumber(a) - toNumber(b));
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

  const stats = useMemo(
    () => (plan && parsed?.errors.length === 0 ? computeStats(plan, enabled) : null),
    [plan, parsed, enabled],
  );

  const blocked =
    !parsed ||
    parsed.errors.length > 0 ||
    parsed.rows.length === 0 ||
    (cancelOrders && parsedOrders.errors.length > 0) ||
    (cancelStops && parsedStops.errors.length > 0);
  const selectedCount = enabled.filter(Boolean).length;
  const quoteAge = quotesAt === null ? null : Math.round((Date.now() - quotesAt) / 1000);

  function updateTemplate(next: Template) {
    setTemplates((current) => current.map((item) => (item.id === next.id ? next : item)));
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
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

      <PasteArea
        id="paste"
        title="Позиции из QUIK"
        columns={template.columns.map((column) => column.name)}
        value={raw}
        onChange={setRaw}
        parsed={parsed}
      />

      <section className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-medium">Снятие блокирующих заявок</h2>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={cancelOrders}
            onCheckedChange={(value) => setCancelOrders(value === true)}
          />
          Снимать активные заявки перед закрытием
        </label>
        <Collapsible open={cancelOrders}>
          <div className="pt-2">
            <PasteArea
              id="paste-orders"
              title="Активные заявки"
              columns={template.orderColumns.map((column) => column.name)}
              value={orderRaw}
              onChange={setOrderRaw}
              parsed={orderRaw.trim() ? parsedOrders : null}
            />
          </div>
        </Collapsible>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={cancelStops}
            onCheckedChange={(value) => setCancelStops(value === true)}
          />
          Снимать стоп-заявки
        </label>
        {cancelStops && (
          <p className="text-xs text-zinc-500">
            Стоп-заявки не отражаются в «Акт. покупка» и «Акт. продажа», поэтому полноту выгрузки
            сверить не с чем — состояние вставки показано в сводке.
          </p>
        )}
        <Collapsible open={cancelStops}>
          <div className="pt-2">
            <PasteArea
              id="paste-stops"
              title="Активные стоп-заявки"
              columns={template.stopColumns.map((column) => column.name)}
              value={stopRaw}
              onChange={setStopRaw}
              parsed={stopRaw.trim() ? parsedStops : null}
            />
          </div>
        </Collapsible>
      </section>

      <section className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-medium">Цена заявки</h2>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-zinc-500">
            Режим
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as OrderMode)}
              className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="market">Рыночная по наихудшей цене</option>
              <option value="limit">Лимитная от стакана</option>
            </select>
          </label>
          <label className="text-xs text-zinc-500">
            Спред на проскальзывание, %
            <Input
              type="number"
              step="0.1"
              min="0"
              value={spread}
              disabled={mode !== "limit"}
              onChange={(e) => setSpread(Number(e.target.value) || 0)}
              className="mt-1 h-9 w-32 text-sm"
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={loadingMarket || instruments.length === 0}
            onClick={() => void refreshMarket(instruments)}
          >
            <RefreshCw /> Обновить котировки
          </Button>
          <span className="text-xs text-zinc-500">
            {loadingMarket
              ? "загрузка…"
              : quoteAge === null
                ? "котировок нет"
                : `обновлено ${quoteAge} с назад`}
          </span>
        </div>

        {quotesError && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            Котировки недоступны: {quotesError}. Доступен только рыночный режим.
          </p>
        )}
        {contractsError && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            Проверка контрактов не выполнена: {contractsError}.
          </p>
        )}
      </section>

      {parsed && plan && (
        <section className="space-y-3">
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
          {plan.templateError && (
            <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {plan.templateError}
            </p>
          )}

          {parsed.rows.length > 0 && (
            <div className="max-h-[32rem] overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
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
                            {active && column.sortByAbs && (
                              <span className="font-normal text-zinc-400">по модулю</span>
                            )}
                          </button>
                        </th>
                      );
                    })}
                    <th className="p-2 font-medium">Проверка</th>
                    <th className="p-2 font-medium">Тип</th>
                    <th className="p-2 text-right font-medium">Цена</th>
                    <th className="p-2 font-medium">Снятий</th>
                  </tr>
                </thead>
                <tbody>
                  {order.map((index, position) => {
                    const item = plan.positions[index];
                    return (
                      <tr key={index} className="border-t border-zinc-200 dark:border-zinc-800">
                        <td className="p-2">
                          <Checkbox
                            checked={enabled[index] === true}
                            aria-label={`Строка ${position + 1}`}
                            onCheckedChange={(value) =>
                              setEnabled((current) =>
                                current.map((flag, i) => (i === index ? value === true : flag)),
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
                        <td
                          className={`p-2 text-xs ${
                            BLOCKING_VERDICTS.has(item?.check.verdict ?? "ok")
                              ? "text-red-600 dark:text-red-400"
                              : "text-zinc-400"
                          }`}
                          title={item?.check.message ?? undefined}
                        >
                          {item ? (VERDICT_LABELS[item.check.verdict] ?? "") : ""}
                        </td>
                        <td className="p-2 text-xs">
                          {item?.priceType === "limit" ? "лимитная" : "рыночная"}
                        </td>
                        <td
                          className="p-2 text-right font-mono text-xs tabular-nums"
                          title={item?.priceReason ?? undefined}
                        >
                          {item?.price ?? "—"}
                        </td>
                        <td className="p-2 text-xs tabular-nums">
                          {item && item.cancels.length + item.stopCancels.length > 0
                            ? item.cancels.length + item.stopCancels.length
                            : ""}
                          {item?.reconcile && (
                            <span
                              className="ml-1 text-amber-600 dark:text-amber-400"
                              title={item.reconcile}
                            >
                              !
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {stats && stats.orders > 0 && (
            <Summary
              stats={stats}
              cancelOrders={cancelOrders}
              cancelStops={cancelStops}
              stopRowCount={parsedStops.rows.length}
              orphanOrders={plan.orphanOrders.length}
              orphanStops={plan.orphanStops.length}
              reconcileGaps={plan.positions
                .filter((item) => item.reconcile)
                .map((item) => `${item.account} · ${item.instrument}: ${item.reconcile}`)}
            />
          )}

          <Button
            disabled={blocked || selectedCount === 0}
            onClick={() =>
              setOutput(
                generate(
                  {
                    template,
                    rows: parsed.rows,
                    orderRows: cancelOrders ? parsedOrders.rows : [],
                    stopRows: cancelStops ? parsedStops.rows : [],
                    market,
                    contractsLoaded,
                    mode,
                    spreadPercent: spread,
                    cancelOrders,
                    cancelStops,
                  },
                  enabled,
                ),
              )
            }
          >
            Сгенерировать транзакции
          </Button>
        </section>
      )}

      {output && !output.templateError && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-sm font-medium">
              Транзакции: {output.rows.filter((row) => row.text).length}
            </h2>
            {output.rows.some((row) => row.reason) && (
              <span className="text-xs text-zinc-500">
                исключено:{" "}
                {output.rows
                  .filter((row) => row.reason)
                  .map((row) => `${row.position} (${row.reason})`)
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
              При сохранении в Блокноте выберите кодировку ANSI (Файл → Сохранить как → Кодировка)
              — QUIK не читает UTF-8.
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

/** Одна вставка: подсказка о колонках, поле, кнопка буфера и разбор. */
function PasteArea({
  id,
  title,
  columns,
  value,
  onChange,
  parsed,
}: {
  id: string;
  title: string;
  columns: string[];
  value: string;
  onChange: (next: string) => void;
  parsed: ParseResult | null;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-sm text-zinc-500">
        Колонки в этом порядке:{" "}
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{columns.join(" · ")}</span>.
        Строку заголовков и колонку с номерами строк можно не убирать. Разделитель — табуляция или
        «;».
      </p>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ctrl+V"
        className="min-h-32 font-mono text-xs"
        spellCheck={false}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              onChange(await navigator.clipboard.readText());
            } catch {
              toast.error("Браузер не дал доступ к буферу — вставьте через Ctrl+V");
            }
          }}
        >
          <ClipboardPaste /> Вставить из буфера
        </Button>
        {value && (
          <Button variant="ghost" size="sm" onClick={() => onChange("")}>
            Очистить
          </Button>
        )}
        {parsed && (
          <span className="text-xs text-zinc-500">
            {parsed.delimiter && `разделитель: ${DELIMITER_LABELS[parsed.delimiter]} · `}
            {parsed.droppedHeader && "шапка отброшена · "}
            {parsed.droppedIndexColumn && "нумерация отброшена · "}
            строк: {parsed.rows.length}
          </span>
        )}
      </div>
      {parsed?.errors.map((message) => (
        <p
          key={message}
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {message}
        </p>
      ))}
    </section>
  );
}

function Summary({
  stats,
  cancelOrders,
  cancelStops,
  stopRowCount,
  orphanOrders,
  orphanStops,
  reconcileGaps,
}: {
  stats: Stats;
  cancelOrders: boolean;
  cancelStops: boolean;
  stopRowCount: number;
  orphanOrders: number;
  orphanStops: number;
  reconcileGaps: string[];
}) {
  return (
    <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{stats.orders}</div>
          <div className="text-xs text-zinc-500">{plural(stats.orders, ORDER)}</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{stats.contracts}</div>
          <div className="text-xs text-zinc-500">{plural(stats.contracts, CONTRACT)}</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{stats.instruments}</div>
          <div className="text-xs text-zinc-500">{plural(stats.instruments, INSTRUMENT)}</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{stats.accounts}</div>
          <div className="text-xs text-zinc-500">{plural(stats.accounts, ACCOUNT)}</div>
        </div>
      </div>

      <dl className="space-y-1 text-sm">
        {stats.byDirection.map((total) => (
          <div key={total.direction} className="flex gap-2">
            <dt className="w-36 shrink-0 text-zinc-500">{total.direction}</dt>
            <dd className="tabular-nums">
              {total.orders} {plural(total.orders, ORDER)} · {total.contracts}{" "}
              {plural(total.contracts, CONTRACT)}
            </dd>
          </div>
        ))}
        <div className="flex gap-2">
          <dt className="w-36 shrink-0 text-zinc-500">Тип заявок</dt>
          <dd className="tabular-nums">
            лимитных {stats.limitOrders} · рыночных {stats.marketOrders}
          </dd>
        </div>
        {stats.largest && (
          <div className="flex gap-2">
            <dt className="w-36 shrink-0 text-zinc-500">Крупнейшая</dt>
            <dd>
              {stats.largest.account} · {stats.largest.instrument} ·{" "}
              {stats.largest.direction.toLowerCase()} {stats.largest.contracts}
            </dd>
          </div>
        )}
        {cancelOrders && (
          <div className="flex gap-2">
            <dt className="w-36 shrink-0 text-zinc-500">Снятие заявок</dt>
            <dd className="tabular-nums">
              {stats.cancels} {plural(stats.cancels, ORDER)}
              {orphanOrders > 0 && ` · без позиции: ${orphanOrders}`}
            </dd>
          </div>
        )}
        {cancelStops && (
          <div className="flex gap-2">
            <dt className="w-36 shrink-0 text-zinc-500">Стоп-заявки</dt>
            <dd className="tabular-nums">
              {stopRowCount === 0 ? (
                <span className="text-amber-600 dark:text-amber-400">вставка пуста</span>
              ) : (
                `${stats.stopCancels} на снятие${orphanStops > 0 ? ` · без позиции: ${orphanStops}` : ""}`
              )}
            </dd>
          </div>
        )}
        {stats.checkFailed > 0 && (
          <div className="flex gap-2">
            <dt className="w-36 shrink-0 text-zinc-500">Не прошло проверку</dt>
            <dd className="tabular-nums text-red-600 dark:text-red-400">
              {stats.checkFailed} {plural(stats.checkFailed, ROW)}
            </dd>
          </div>
        )}
        {stats.skipped > 0 && (
          <div className="flex gap-2">
            <dt className="w-36 shrink-0 text-zinc-500">Не войдёт</dt>
            <dd className="tabular-nums">
              {stats.skipped} {plural(stats.skipped, ROW)}
              {stats.failed > 0 && `, из них с ошибкой: ${stats.failed}`}
            </dd>
          </div>
        )}
      </dl>

      <div className="space-y-1">
        <div className="text-xs text-zinc-500">
          Инструменты в пачке — проверьте, что это только закрываемая серия
        </div>
        <ul className="flex flex-wrap gap-1">
          {stats.byInstrument.map((item) => (
            <li
              key={item.instrument}
              className="rounded border border-zinc-300 bg-white px-2 py-0.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
              title={`${item.orders} ${plural(item.orders, ORDER)}`}
            >
              {item.instrument} <span className="text-zinc-500 tabular-nums">{item.contracts}</span>
            </li>
          ))}
        </ul>
      </div>

      {reconcileGaps.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Объём снимаемых заявок не сходится с заблокированным: {reconcileGaps.join("; ")}. Похоже,
          часть заявок не попала в выгрузку — закрытие таких позиций будет отвергнуто.
        </p>
      )}

      {stats.duplicates.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Пара «счёт + инструмент» встречается больше одного раза: {stats.duplicates.join("; ")}.
        </p>
      )}
    </div>
  );
}
