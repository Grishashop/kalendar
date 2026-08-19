"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Copy, Download, RefreshCw, Settings2 } from "lucide-react";
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
import { FORTS_ASSETS_DATE, FORTS_SERIES_HORIZON, type CheckVerdict } from "@/lib/karman/checks";
import { loadContracts, loadQuotes } from "@/lib/karman/market";
import type { ContractInfo } from "@/lib/karman/contracts";
import type { OrderMode, Quote } from "@/lib/karman/pricing";
import { computeStats, type Stats } from "@/lib/karman/stats";
import { toWindows1251, triFileName } from "@/lib/karman/tri";
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

// Малая непрозрачность: заливка ложится поверх фона чипа и в светлой, и в тёмной
// теме, оставляя моноширинный текст читаемым. `intensity` гасит выключенный чип.
const LONG_FILL = (intensity: number) => `rgba(34,197,94,${0.28 * intensity})`;
const SHORT_FILL = (intensity: number) => `rgba(239,68,68,${0.28 * intensity})`;

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

/**
 * `offline` — сборка для запуска с файла внутри организации, без выхода
 * в интернет. Отпадает всё, что требует сети: справочник FORTS и котировки.
 * Значит нет проверки серии и нет лимитного режима — заявки уходят рыночными
 * с нулевой ценой, планку применяет биржа. Разбор, шаблоны, сверка объёма,
 * сводка и запись .tri работают целиком: они и так считаются в браузере.
 */
export function Generator({ offline = false }: { offline?: boolean } = {}) {
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

  // UID трейдера для комментария транзакции. По умолчанию пусто и генерация
  // заблокирована: файлом пользуются несколько человек, и молчаливое значение
  // по умолчанию однажды отправит пачку под чужим UID. «Без UID» — осознанный
  // выбор, а не то же самое, что незаполненное поле.
  const [uid, setUid] = useState("");
  const [noUid, setNoUid] = useState(false);

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

  /**
   * `withPrices` разделяет два разных намерения. Без него грузится только список
   * FORTS — проверка серии за две десятых секунды, единственное, что стоит между
   * пачкой и закрытием не той серии. С ним добавляются котировки Alor и
   * уточнение поставочности по карточкам, которое стоит до восьми секунд.
   *
   * Рыночной заявке цены не нужны вовсе: она уходит с нулём, планку применяет
   * биржа. Поэтому падение Alor или ISS больше не останавливает генерацию.
   */
  const refreshMarket = useCallback(
    async (secids: readonly string[], withPrices: boolean) => {
      // В офлайн-сборке сети нет вовсе: запрос не «упадёт с ошибкой», его просто
      // не должно быть. Иначе на каждой вставке была бы секунда ожидания и
      // плашка «справочник недоступен» на пустом месте.
      if (offline || secids.length === 0) return;
      setLoadingMarket(true);
      const [reference, quote] = await Promise.all([
        loadContracts(secids, withPrices),
        withPrices ? loadQuotes(secids) : null,
      ]);
      setContracts(reference.contracts);
      setContractsLoaded(reference.loaded);
      setContractsError(reference.error);
      if (quote) {
        setQuotes(quote.quotes);
        setQuotesError(quote.error);
        setQuotesAt(quote.loaded ? quote.at : null);
      }
      setLoadingMarket(false);
    },
    [offline],
  );

  // Вставили таблицу — проверяем серию. Котировки ждут переключения в лимитный
  // режим: рыночной заявке они не нужны, а запрос стоит времени и токена.
  const instrumentKey = instruments.join(",");
  const wantPrices = mode === "limit";
  useEffect(() => {
    void refreshMarket(instrumentKey ? instrumentKey.split(",") : [], wantPrices);
  }, [instrumentKey, wantPrices, refreshMarket]);

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
            uid: noUid ? "" : uid.trim(),
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
      uid,
      noUid,
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

  // Пустое поле UID и снятая галочка — это «трейдер ещё не решил», а не «без
  // UID». Различать обязательно: иначе пачка уйдёт с чужим или пустым
  // комментарием, и разбираться придётся по факту исполнения.
  const uidReady = noUid || uid.trim() !== "";

  const blocked =
    !parsed ||
    parsed.errors.length > 0 ||
    parsed.rows.length === 0 ||
    !uidReady ||
    (cancelOrders && parsedOrders.errors.length > 0) ||
    (cancelStops && parsedStops.errors.length > 0);

  // Просили лимитную, а строка ушла рыночной. Группируем по причине с тикерами:
  // подсветка в таблице говорит «смотри сюда», а это — «вот что и почему»,
  // не заставляя листать пятьдесят строк.
  const marketFallback = useMemo(() => {
    if (mode !== "limit" || !plan) return { rows: 0, groups: [] as { reason: string; tickers: string[] }[] };
    const byReason = new Map<string, string[]>();
    let rows = 0;
    plan.positions.forEach((item) => {
      if (item.error || !enabled[item.index]) return;
      if (item.priceType !== "market") return;
      rows += 1;
      const reason = item.priceReason ?? "причина неизвестна";
      const list = byReason.get(reason) ?? [];
      // Тикеры без повторов: одна серия встречается на нескольких счетах,
      // и перечислять её пять раз значит спрятать остальные.
      if (!list.includes(item.instrument)) list.push(item.instrument);
      byReason.set(reason, list);
    });
    return { rows, groups: [...byReason].map(([reason, tickers]) => ({ reason, tickers })) };
  }, [mode, plan, enabled]);
  const selectedCount = enabled.filter(Boolean).length;
  // Сколько строк отбито проверкой и по каким причинам — чтобы выключенная
  // кнопка называла причину, а не молчала.
  const blockedRows =
    plan?.positions.filter((item) => BLOCKING_VERDICTS.has(item.check.verdict)).length ?? 0;
  const blockedSummary = [
    ...new Map(
      (plan?.positions ?? [])
        .filter((item) => BLOCKING_VERDICTS.has(item.check.verdict))
        .map((item) => [item.check.verdict, VERDICT_LABELS[item.check.verdict] ?? item.check.verdict]),
    ).values(),
  ].join(", ");
  const allSelected = enabled.length > 0 && selectedCount === enabled.length;
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
        {/* Ссылка на автономный файл: внутри организации интернета нет, а
            скачать сборку надо один раз — снаружи. В самой офлайн-сборке ссылки
            нет: она вела бы в сеть, которой там не существует. */}
        {!offline && (
          <p className="text-xs text-zinc-500">
            Нет доступа в интернет на рабочем месте?{" "}
            <a
              href="/karman-offline.html"
              download="karman-offline.html"
              className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Скачайте автономный файл
            </a>{" "}
            — один html, открывается двойным щелчком, работает без сети. Разбор вставки, шаблоны,
            сверка объёма и запись .tri целиком; проверки серии по справочнику биржи и лимитных цен
            там нет — заявки уходят рыночными.
          </p>
        )}
      </header>

      {/* UID стоит выше вставки: он попадает в каждую транзакцию, и решать про
          него надо до того, как человек увлёкся разбором пятидесяти строк. */}
      <section className="space-y-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-medium">Ваш UID</h2>
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-xs text-zinc-500">
            UID
            <Input
              value={uid}
              disabled={noUid}
              inputMode="numeric"
              placeholder="62"
              onChange={(e) => setUid(e.target.value)}
              className="mt-1 h-9 w-28 font-mono text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={noUid}
              onCheckedChange={(value) => setNoUid(value === true)}
            />
            Без UID-а
          </label>
          <span className="text-xs text-zinc-500">
            {noUid
              ? "Комментарий транзакции останется пустым."
              : uid.trim() === ""
                ? "Укажите UID или отметьте «Без UID-а» — без этого генерация недоступна."
                : `Комментарий транзакции: /&!${uid.trim()}`}
          </span>
        </div>
      </section>

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
        {offline ? (
          // Выбора нет: лимитная цена строится от стакана, стакан приходит по
          // сети. Показываем не выключенные поля, а прямое объяснение — иначе
          // человек будет щёлкать переключатель и думать, что сломалось.
          <p className="text-sm text-zinc-500">
            Заявки уходят <span className="font-medium">рыночными</span> с ценой ноль — предельную
            цену применит биржа. Лимитный режим требует стакана, а он приходит по сети: в этой
            сборке её нет.
          </p>
        ) : (
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
            // В рыночном режиме котировки не нужны: заявка уходит с нулевой ценой,
            // планку применяет биржа. Кнопка живая только там, где цена строится.
            disabled={loadingMarket || instruments.length === 0 || mode !== "limit"}
            onClick={() => void refreshMarket(instruments, true)}
          >
            <RefreshCw /> Обновить котировки
          </Button>
          <span className="text-xs text-zinc-500">
            {/* Проверка серии приезжает после таблицы. Пока она в пути, строки
                стоят с вердиктом «—» и все отмечены: без индикатора это выглядит
                как «проверено, всё чисто», и можно сгенерировать не ту серию. */}
            {loadingMarket
              ? mode === "limit"
                ? "загрузка котировок…"
                : "проверка серии…"
              : mode !== "limit"
                ? "рыночная заявка: цену определит биржа"
                : quoteAge === null
                  ? "котировок нет"
                  : `обновлено ${quoteAge} с назад`}
          </span>
        </div>
        )}

        {/* Настоящего прогресса нет: сколько осталось, зависит от того, насколько
            сейчас тормозит ISS или Alor. Полоса неопределённая — она говорит
            «работаю», а не рисует выдуманные проценты. */}
        {loadingMarket && (
          <div
            role="progressbar"
            aria-label={mode === "limit" ? "Загрузка котировок" : "Проверка серии"}
            className="h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          >
            <div className="animate-indeterminate h-full w-2/5 rounded-full bg-zinc-500 dark:bg-zinc-400" />
          </div>
        )}

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

        {/* Справочник биржи не загрузился — проверяем по встроенному. Возраст
            обязателен на экране: он и определяет, чему верить. */}
        {!contractsLoaded && (
          <p className="text-xs text-zinc-500">
            Проверка идёт по встроенному справочнику FORTS от {FORTS_ASSETS_DATE}: поставочность,
            ближайшая серия и дата погашения — по настоящим датам обращения, известным до{" "}
            {FORTS_SERIES_HORIZON}. Незнакомый инструмент и серию за этим сроком справочник не
            блокирует, а помечает «не проверен»: блокировать поставочный контракт по незнанию
            значит отправить позицию на поставку.
          </p>
        )}

        {/* Подсветка в таблице говорит «смотри сюда», а этот блок — «что именно
            и почему», не заставляя листать пятьдесят строк. Отдельная плашка,
            а не строка в сводке: просили лимитную, получили другое исполнение. */}
        {marketFallback.rows > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <p className="font-medium">
              Рыночными вместо лимитных: {marketFallback.rows}{" "}
              {plural(marketFallback.rows, ORDER)} — цену определит биржа.
            </p>
            <ul className="mt-1 space-y-0.5">
              {marketFallback.groups.map((group) => (
                <li key={group.reason} className="font-mono text-xs">
                  {group.reason}: {group.tickers.join(", ")}
                </li>
              ))}
            </ul>
          </div>
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
            <div className="text-xs text-zinc-500">
              отмечено {selectedCount} из {parsed.rows.length}
            </div>
          )}

          {parsed.rows.length > 0 && (
            <div className="max-h-[32rem] overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-zinc-100 text-left text-xs dark:bg-zinc-900">
                  <tr>
                    <th className="w-10 p-2">
                      <Checkbox
                        checked={allSelected}
                        aria-label={allSelected ? "Снять все строки" : "Отметить все строки"}
                        onCheckedChange={() => setEnabled((current) => current.map(() => !allSelected))}
                      />
                    </th>
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
                        {/* Просили лимитную, а строка ушла рыночной — это другое
                            исполнение, а не оттенок. В прежнем виде «рыночная»
                            стояла тем же серым, что «лимитная», и восемь строк
                            из пятидесяти двух не бросались в глаза.
                            В рыночном режиме не подсвечиваем: там так задумано. */}
                        <td
                          className={`p-2 text-xs ${
                            mode === "limit" && item?.priceType === "market"
                              ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              : ""
                          }`}
                          title={item?.priceReason ?? undefined}
                        >
                          {item?.priceType === "limit" ? "лимитная" : "рыночная"}
                          {mode === "limit" && item?.priceType === "market" && " !"}
                        </td>
                        <td
                          className={`p-2 text-right font-mono text-xs tabular-nums ${
                            mode === "limit" && item?.priceType === "market"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              : ""
                          }`}
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

          {/* Условие по инструментам, а не по заявкам: после «снять все» сводка
              обязана остаться на экране — иначе чипами нечего будет включить. */}
          {stats && stats.byInstrument.length > 0 && (
            <Summary
              stats={stats}
              cancelOrders={cancelOrders}
              cancelStops={cancelStops}
              stopRowCount={parsedStops.rows.length}
              limitMode={mode === "limit"}
              orphanOrders={plan.orphanOrders.length}
              orphanStops={plan.orphanStops.length}
              inactiveOrders={plan.inactiveOrders.length}
              inactiveStops={plan.inactiveStops.length}
              reconcileGaps={plan.positions
                .filter((item) => item.reconcile)
                .map((item) => `${item.account} · ${item.instrument}: ${item.reconcile}`)}
              onToggleInstrument={(rows, on) =>
                setEnabled((current) =>
                  current.map((flag, i) => (rows.includes(i) ? on : flag)),
                )
              }
              onToggleAll={(on) => setEnabled((current) => current.map(() => on))}
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
                    uid: noUid ? "" : uid.trim(),
                  },
                  enabled,
                ),
              )
            }
          >
            Сгенерировать транзакции
          </Button>
          {/* Выключенная кнопка без объяснения читается как поломка: человек
              жмёт, ничего не происходит, и он идёт разбираться не туда.
              Причин ровно три, и каждая называется своим текстом. */}
          {(blocked || selectedCount === 0) && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {!uidReady
                ? "Генерация недоступна: укажите свой UID или отметьте «Без UID-а» в блоке выше."
                : blocked
                  ? "Генерация недоступна: во вставке есть ошибки — исправьте их выше."
                  : blockedRows > 0 && blockedRows === plan.positions.length
                    ? `Генерация недоступна: ни одна строка не прошла проверку (${blockedSummary}). ` +
                      "Отметить строку можно вручную, но сначала убедитесь, что серия та."
                    : "Генерация недоступна: не отмечено ни одной строки."}
            </p>
          )}
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
            {/*
              Кнопка пишет байты сама, поэтому Блокнот из цепочки исчезает —
              вместе с его ловушкой: новый файл он создаёт в UTF-8, а QUIK
              tri-файлы читает только в ANSI (windows-1251). Проверено на
              выгрузке самого терминала.
            */}
            <Button
              variant="outline"
              onClick={() => {
                const { bytes, unmapped } = toWindows1251(output.text);
                if (unmapped.length > 0) {
                  // Молча подставить «?» нельзя: это правка поля транзакции.
                  toast.error("В тексте есть символы вне кодировки QUIK", {
                    description: `Уберите их в шаблоне: ${unmapped.join(" ")}`,
                    duration: Infinity,
                  });
                  return;
                }
                const name = triFileName();
                const url = URL.createObjectURL(
                  new Blob([bytes as BlobPart], { type: "application/octet-stream" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = name;
                link.click();
                URL.revokeObjectURL(url);
                toast.success(`Сохранено: ${name}`, {
                  description: "Кодировка ANSI — файл готов к загрузке в карман QUIK.",
                });
              }}
            >
              <Download /> Скачать .tri
            </Button>
            <span className="text-xs text-zinc-500">
              Файл пишется в ANSI (windows-1251) — той же кодировке, в которой tri-файлы пишет сам
              QUIK. При копировании через буфер и сохранении Блокнотом кодировку надо переключать
              вручную: Файл → Сохранить как → Кодировка.
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
  limitMode,
  stopRowCount,
  orphanOrders,
  orphanStops,
  inactiveOrders,
  inactiveStops,
  reconcileGaps,
  onToggleInstrument,
  onToggleAll,
}: {
  stats: Stats;
  cancelOrders: boolean;
  cancelStops: boolean;
  stopRowCount: number;
  /** Лимитный режим: рыночные заявки в сводке становятся отступлением. */
  limitMode: boolean;
  orphanOrders: number;
  orphanStops: number;
  inactiveOrders: number;
  inactiveStops: number;
  reconcileGaps: string[];
  onToggleInstrument: (rows: readonly number[], on: boolean) => void;
  onToggleAll: (on: boolean) => void;
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
            лимитных {stats.limitOrders} ·{" "}
            {/* В лимитном режиме рыночная заявка — отступление от того, что просили,
                и в сводке она обязана выделяться, а не стоять рядом как равная. */}
            <span
              className={
                limitMode && stats.marketOrders > 0
                  ? "font-medium text-amber-600 dark:text-amber-400"
                  : ""
              }
            >
              рыночных {stats.marketOrders}
            </span>
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
              {inactiveOrders > 0 && ` · исполнено или снято: ${inactiveOrders}`}
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
                `${stats.stopCancels} на снятие` +
                (inactiveStops > 0 ? ` · исполнено или снято: ${inactiveStops}` : "") +
                (orphanStops > 0 ? ` · без позиции: ${orphanStops}` : "")
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
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span>
            Инструменты во вставке — отмеченные уйдут в карман; зелёное закрывается продажей,
            красное покупкой
          </span>
          <button
            type="button"
            className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
            onClick={() => onToggleAll(true)}
          >
            отметить все
          </button>
          <button
            type="button"
            className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
            onClick={() => onToggleAll(false)}
          >
            снять все
          </button>
        </div>
        <ul className="flex flex-wrap gap-1">
          {stats.byInstrument.map((item) => {
            // Цвет кодирует сторону ПОЗИЦИИ, а не заявки: лонг зелёный, шорт
            // красный. Это противоположно раскраске стакана QUIK, где зелёная
            // покупка, — не «исправлять».
            //
            // Долю несёт положение границы, а не оттенок: красный и зелёный —
            // худшая пара для различения, и при дейтеранопии читаться должен
            // сам стык. Отсюда жёсткие остановки градиента вместо перехода.
            const longShare = item.contracts > 0 ? (item.long / item.contracts) * 100 : 0;
            const all = item.enabledCount === item.rows.length;
            const none = item.enabledCount === 0;
            // Выключенный чип гасим прозрачностью, а не зачёркиванием: зачёркнутый
            // моноширинный текст в двадцать пикселей нечитаем.
            const fill = none ? 0.35 : 1;
            return (
              <li key={item.instrument}>
                <button
                  type="button"
                  aria-pressed={!none}
                  className={`rounded border px-2 py-0.5 font-mono text-xs transition-opacity ${
                    none
                      ? "border-zinc-200 bg-white text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-600"
                      : all
                        ? "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950"
                        : "border-dashed border-zinc-400 bg-white dark:border-zinc-500 dark:bg-zinc-950"
                  }`}
                  style={{
                    backgroundImage: `linear-gradient(to right, ${LONG_FILL(fill)} 0 ${longShare}%, ${SHORT_FILL(fill)} ${longShare}% 100%)`,
                  }}
                  title={
                    `${item.instrument}: лонг ${item.long} · шорт ${item.short} · ` +
                    `${item.orders} ${plural(item.orders, ORDER)} · ` +
                    `отмечено ${item.enabledCount} из ${item.rows.length}`
                  }
                  // Всё включено — выключаем; в любом другом состоянии включаем.
                  // То же правило, что у чекбокса в шапке таблицы.
                  onClick={() => onToggleInstrument(item.rows, !all)}
                >
                  {item.instrument}{" "}
                  <span className={none ? "tabular-nums" : "text-zinc-500 tabular-nums"}>
                    {item.contracts}
                  </span>
                </button>
              </li>
            );
          })}
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
