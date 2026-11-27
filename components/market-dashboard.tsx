"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Coins, Droplet, Flame, Landmark, Globe, RotateCcw } from "lucide-react";
import { restoreMissing } from "@/lib/moex/snapshot";
import type { MarketResponse, Quote, IndexQuote } from "@/app/api/market/route";

// Фиксированная тёмная тема финансового терминала. Внутри «зоны скриншота»
// используются ТОЛЬКО жёстко закодированные Tailwind-классы (не семантические
// токены bg-background и т.п.) — иначе светлая тема приложения испортит скриншот.

// --- Логотипы бумаг ---

// Локальные логотипы (public/logos/) — 50 самых ликвидных тикеров TQBR
// (голубые фишки + типовой состав топ-20 по обороту), скачаны с
// invest-brands.cdn-tinkoff.ru по официальным брендам. Тикеров вне этого
// набора (редкие бумаги в топ-20, фьючерсы) — просто аватар с инициалами;
// <img onError> переключает на него, если файла нет.
const KNOWN_LOGOS: Record<string, true> = {
  ABIO: true, AFKS: true, AFLT: true, AKRN: true, ALRS: true, ASTR: true,
  BSPB: true, CBOM: true, CHMF: true, DIAS: true, ENPG: true, ETLN: true,
  FEES: true, FLOT: true, GAZP: true, GMKN: true, HYDR: true, IRAO: true,
  KMAZ: true, LEAS: true, LKOH: true, LSNG: true, MGNT: true, MOEX: true,
  MTLR: true, MTSS: true, NLMK: true, NVTK: true, OZON: true, PHOR: true,
  PLZL: true, POSI: true, RASP: true, ROSN: true, RTKM: true, RUAL: true,
  SBER: true, SGZH: true, SMLT: true, SNGS: true, SNGSP: true, SVCB: true,
  T: true, TATN: true, TATNP: true, UPRO: true, VKCO: true, VTBR: true,
  WUSH: true, YDEX: true,
};

function StockLogo({ secid, compact }: { secid: string; compact: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = compact ? 20 : 28;
  const box = "shrink-0 rounded-md";
  if (failed || !KNOWN_LOGOS[secid]) {
    return (
      <div
        className={`${box} flex items-center justify-center bg-slate-800 text-[9px] font-medium text-slate-400`}
        style={{ width: size, height: size }}
      >
        {secid.slice(0, 2)}
      </div>
    );
  }
  return (
    <img
      src={`/logos/${secid}.png`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`${box} bg-white object-contain p-0.5`}
      style={{ width: size, height: size }}
    />
  );
}

// --- Иконки валют, сырья и индексов ---

// Флаги эмитента валюты — не требуют картинок и одинаково хорошо смотрятся
// на тёмном фоне без белой подложки (в отличие от растровых лого бумаг).
const CURRENCY_FLAG: Record<string, string> = {
  USD_CBR: "🇺🇸",
  USD000UTSTOM: "🇺🇸",
  EUR_CBR: "🇪🇺",
  EUR_RUB__TOM: "🇪🇺",
  CNY_CBR: "🇨🇳",
  CNYRUB_TOM: "🇨🇳",
};

function CurrencyFlag({ secid }: { secid: string }) {
  const flag = CURRENCY_FLAG[secid];
  if (!flag) return null;
  return (
    <span className="shrink-0 text-base leading-none" aria-hidden>
      {flag}
    </span>
  );
}

// Сырьё определяем по name (q.secid — это код фронт-контракта, "BRQ6" и
// т.п., меняется по экспирациям и не годится в ключ).
const COMMODITY_ICON: Record<
  string,
  { Icon: typeof Droplet; className: string }
> = {
  Brent: { Icon: Droplet, className: "text-amber-500" },
  Золото: { Icon: Coins, className: "text-yellow-400" },
  "Природный газ": { Icon: Flame, className: "text-orange-400" },
};

function CommodityIcon({ name }: { name: string }) {
  const cfg = COMMODITY_ICON[name];
  if (!cfg) return null;
  const { Icon, className } = cfg;
  return <Icon className={`h-4 w-4 shrink-0 ${className}`} aria-hidden />;
}

// Индексы — не бумаги с брендом, а расчётные показатели биржи; монохромная
// иконка вместо лого, тон приглушённый под тёмную тему (без белых подложек).
function IndexIcon({ secid }: { secid: string }) {
  const Icon = secid === "RTSI" ? Globe : Landmark;
  return <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />;
}

// --- Форматирование (ru-RU) ---

function fmtNum(v: number | null, maxFrac = 2): string {
  if (v === null) return "—";
  return v.toLocaleString("ru-RU", { maximumFractionDigits: maxFrac });
}

// Изменение в процентах: всегда со знаком, минус — типографский «−».
function fmtPct(v: number | null): string {
  if (v === null) return "—";
  const sign = v >= 0 ? "+" : "−";
  const abs = Math.abs(v).toLocaleString("ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${sign}${abs}%`;
}

function changeColor(v: number | null): string {
  if (v === null) return "text-slate-300";
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-red-400";
  return "text-slate-300";
}

function arrow(v: number | null): string {
  if (v === null || v === 0) return "";
  return v > 0 ? "▲" : "▼";
}

// --- Генератор авто-комментария ---

// prevClose восстанавливаем из last и changePct (% к закрытию пред. дня).
function generateCommentary(data: MarketResponse): string {
  const parts: string[] = [];
  const imoex = data.indices.find((q) => q.secid === "IMOEX");
  const rtsi = data.indices.find((q) => q.secid === "RTSI");

  const pctWord = (p: number, up: string, down: string, flat: string) =>
    p > 0.1 ? up : p < -0.1 ? down : flat;

  // 1. Открытие IMOEX.
  if (
    imoex &&
    imoex.last !== null &&
    imoex.changePct !== null &&
    imoex.open !== null
  ) {
    const prevClose = imoex.last / (1 + imoex.changePct / 100);
    if (prevClose !== 0) {
      const openPct = ((imoex.open - prevClose) / prevClose) * 100;
      const phrase = pctWord(
        openPct,
        `открылся ростом на ${fmtNum(Math.abs(openPct), 1)}%`,
        `открылся снижением на ${fmtNum(Math.abs(openPct), 1)}%`,
        "открылся нейтрально",
      );
      parts.push(`Индекс МосБиржи ${phrase}.`);
    }
  }

  // 2. Текущая динамика.
  if (imoex && imoex.last !== null && imoex.changePct !== null) {
    const time = data.moexTime ? data.moexTime.slice(0, 5) : null;
    const prefix = time ? `К ${time} МСК индекс ` : "Индекс ";
    const dyn =
      Math.abs(imoex.changePct) <= 0.1
        ? "торгуется около нуля"
        : `${imoex.changePct > 0 ? "растёт" : "снижается"} на ${fmtNum(Math.abs(imoex.changePct), 1)}%`;
    let sentence = `${prefix}${dyn} и составляет ${fmtNum(imoex.last)} п.`;
    if (rtsi && rtsi.last !== null && rtsi.changePct !== null) {
      sentence += ` РТС — ${fmtNum(rtsi.last)} п. (${fmtPct(rtsi.changePct)}).`;
    } else {
      sentence += ".";
    }
    parts.push(sentence);
  }

  // 3. Лидеры / аутсайдеры.
  const movers = data.stocks.filter(
    (q) => q.changePct !== null && q.changePct !== 0,
  );
  if (movers.length > 0) {
    const gainers = movers
      .filter((q) => (q.changePct as number) > 0)
      .sort((a, b) => (b.changePct as number) - (a.changePct as number))
      .slice(0, 2);
    const losers = movers
      .filter((q) => (q.changePct as number) < 0)
      .sort((a, b) => (a.changePct as number) - (b.changePct as number))
      .slice(0, 2);
    const seg: string[] = [];
    if (gainers.length > 0) {
      seg.push(
        "в лидерах роста — " +
          gainers
            .map((q) => `${q.name} (${fmtPct(q.changePct)})`)
            .join(" и "),
      );
    }
    if (losers.length > 0) {
      seg.push(
        "под давлением — " +
          losers
            .map((q) => `${q.name} (${fmtPct(q.changePct)})`)
            .join(" и "),
      );
    }
    if (seg.length > 0) {
      const s = seg.join(", ");
      parts.push(s.charAt(0).toUpperCase() + s.slice(1) + ".");
    }
  }

  // 4. Сырьё.
  const brent = data.commodities.find((q) => q.secid.startsWith("BR"));
  const gold = data.commodities.find((q) => q.name === "Золото");
  if (brent && brent.last !== null && brent.changePct !== null) {
    let s = `Brent ${pctWord(brent.changePct, "дорожает", "дешевеет", "почти не меняется")}`;
    if (Math.abs(brent.changePct) > 0.1) {
      s += ` на ${fmtNum(Math.abs(brent.changePct), 1)}%`;
    }
    s += ` до $${fmtNum(brent.last)} за баррель`;
    if (gold && gold.last !== null) {
      s += `, золото — $${fmtNum(gold.last)} за унцию`;
      if (gold.changePct !== null) s += ` (${fmtPct(gold.changePct)})`;
    }
    parts.push(s + ".");
  }

  // 5. Рубль.
  const usd = data.currencies.find((q) => q.secid === "USD_CBR");
  const cny = data.currencies.find(
    (q) => q.secid === "CNYRUB_TOM" || q.secid === "CNY_CBR",
  );
  if (usd && usd.last !== null) {
    let s = `Официальный курс доллара — ${fmtNum(usd.last)} ₽`;
    if (usd.changePct !== null) s += ` (${fmtPct(usd.changePct)} к предыдущему дню)`;
    if (cny && cny.last !== null) {
      const place = cny.secid === "CNYRUB_TOM" ? "на бирже" : "по курсу ЦБ";
      s += `, юань ${place} — ${fmtNum(cny.last)} ₽`;
    }
    parts.push(s + ".");
  }

  return parts.join(" ");
}

// --- Спарклайн ---

function IndexChart({ q, values, color, day, historical }: {
  q: IndexQuote; values: number[]; color: string; day?: string; historical: boolean;
}) {
  const line = values.length >= 2;
  const sessionRange = !historical && q.low !== null && q.high !== null && q.last !== null &&
    q.low <= q.last && q.last <= q.high;
  if (!line && !sessionRange) return null;
  const low = sessionRange ? q.low! : Math.min(...values);
  const high = sessionRange ? q.high! : Math.max(...values);
  const last = sessionRange ? q.last! : values[values.length - 1];
  const position = low === high ? 50 : 100 * (last - low) / (high - low);
  const base = !historical && q.last !== null && q.changePct !== null && q.changePct > -100
    ? q.last / (1 + q.changePct / 100) : null;
  const min = Math.min(low, ...values, base ?? Infinity);
  const max = Math.max(high, ...values, base ?? -Infinity);
  const y = (v: number) => max === min ? 32 : 58 - 52 * (v - min) / (max - min);
  const points = values.map((v,i) => `${320*i/(values.length-1)},${y(v)}`).join(" ");
  const accent = historical ? "#93c5fd" : color;
  return (
    <figure className="mt-3 rounded-lg bg-slate-950/35 px-3 py-2.5 text-[11px] text-slate-400 tabular-nums">
      <figcaption className="flex flex-wrap justify-between gap-x-2">
        <span>{line ? "Динамика" : "Диапазон котировки"}{line && day && " · " + new Date(day+"T12:00:00Z").toLocaleDateString("ru-RU",{day:"numeric",month:"long"})}</span>
        {line && base !== null && <span>┄ Пред. закрытие {fmtNum(base)}</span>}
      </figcaption>
      {line && <svg className="my-1 h-16 w-full" viewBox="0 0 320 64" preserveAspectRatio="none" role="img" aria-label="Внутридневная динамика индекса">
        {base !== null && <line x1="0" x2="320" y1={y(base)} y2={y(base)} stroke="#64748b" strokeDasharray="3 4" />}
        <polyline points={points} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>}
      <div title={sessionRange ? "Положение цены в диапазоне котировки" : "Диапазон цен закрытия свечей"} className="relative mx-1 my-2 h-1 rounded-full bg-slate-700">
        <span style={{left:position+"%",backgroundColor:accent}} className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-900" />
      </div>
      <div className="flex justify-between"><span>Мин {fmtNum(low)}</span><span>{!sessionRange && "По свечам"}</span><span>Макс {fmtNum(high)}</span></div>
    </figure>
  );
}

function ChangeBadge({ pct }: { pct: number | null }) {
  const tiny = pct !== null && pct !== 0 && Math.abs(pct) < 0.05;
  return (
    <span title={pct === null ? undefined : pct.toLocaleString("ru-RU", {maximumSignificantDigits: 8}) + "%"}
      className={`whitespace-nowrap font-semibold tabular-nums ${tiny ? "text-slate-400" : changeColor(pct)}`}>
      {tiny ? "< 0,1%" : pct === 0 ? "0,0%" : `${arrow(pct)} ${fmtPct(pct)}`.trim()}
    </span>
  );
}

function IndexCard({
  q,
  spark,
  day, historical,
  compact,
}: {
  q: IndexQuote;
  spark: number[];
  day?: string; historical: boolean;
  compact: boolean;
}) {
  const strokeColor =
    q.changePct === null || q.changePct === 0
      ? "#cbd5e1"
      : q.changePct > 0
        ? "#34d399"
        : "#f87171";
  return (
    <div title={quoteInfo(q)}
      className={`rounded-xl border border-slate-800 bg-slate-900 ${compact ? "p-3" : "p-5"}`}
    >
      <div
        className={`flex items-start justify-between ${compact ? "gap-3" : "gap-4"}`}
      >
        <div className="min-w-0">
          <div
            className={`flex items-center gap-1.5 text-slate-400 ${compact ? "text-xs" : "text-sm"}`}
          >
            <IndexIcon secid={q.secid} />
            {q.name}{q.cached && <small> · сохранено</small>}
          </div>
          <div
            className={`mt-1 font-bold text-slate-100 ${compact ? "text-2xl" : "text-3xl"}`}
          >
            {fmtNum(q.last)}{" "}
            <span
              className={`font-normal text-slate-400 ${compact ? "text-sm" : "text-base"}`}
            >
              {q.unit}
            </span>
          </div>
          <div className={compact ? "mt-0.5" : "mt-1"}>
            <div className={compact ? "text-base" : "text-lg"}>
              <ChangeBadge pct={q.changePct} />
            </div>
          </div>
        </div>

      </div>
      <IndexChart q={q} values={spark} color={strokeColor} day={day} historical={historical} />
      {q.open !== null && <div className="mt-2 text-[11px] tabular-nums text-slate-400">Открытие {fmtNum(q.open)}</div>}
      {q.future && q.future.last !== null && (
        <div
          className={`flex items-center justify-between gap-2 border-t border-slate-800 ${compact ? "mt-2 pt-2" : "mt-3 pt-3"}`}
        >
          <span
            className={`text-slate-400 ${compact ? "text-[11px]" : "text-xs"}`}
          >
            Фьючерс {q.future.shortName}
          </span>
          <span
            className={`font-medium text-slate-200 ${compact ? "text-sm" : "text-base"}`}
          >
            {fmtNum(q.future.last)} п. <ChangeBadge pct={q.future.changePct} />
          </span>
        </div>
      )}
    </div>
  );
}

// Валюты уже приходят в нужном порядке (Доллар, Евро, Юань) — сырьё с
// сервера идёт как Brent/Золото/Газ (см. buildCommodities), тут для
// панели "Валюты и сырьё" переставляем под Золото/Нефть/Газ.
const COMMODITY_ORDER = ["Золото", "Brent", "Природный газ"];
function orderCommodities(commodities: Quote[]): Quote[] {
  return [...commodities].sort(
    (a, b) => COMMODITY_ORDER.indexOf(a.name) - COMMODITY_ORDER.indexOf(b.name),
  );
}

function quoteInfo(q: Quote) {
  const time = q.candleTime ?? q.observedAt ?? q.receivedAt;
  return [q.cached && "Последние доступные данные", q.source, time &&
    (q.candleTime ? "Начало свечи " : q.observedAt ? "Цена на " : "Получено ") + new Date(time).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " МСК"
  ].filter(Boolean).join(" · ");
}

function MiniCard({ q, compact }: { q: Quote; compact: boolean }) {
  return (
    <div title={quoteInfo(q)}
      className={`rounded-xl border border-slate-800 bg-slate-900 ${compact ? "p-2" : "p-3"}`}
    >
      <div
        className="flex min-h-8 items-start gap-1.5 text-xs leading-4 text-slate-400"
        title={quoteInfo(q)}
      >
        <span className="mt-0.5 flex shrink-0 items-center gap-1">
          <CurrencyFlag secid={q.secid} />
          <CommodityIcon name={q.name} />
        </span>
        <span className="min-w-0 break-words">
          {q.name}{q.cached && <small> · сохранено</small>}
          {q.contract && <span className="text-slate-500"> · {q.contract}</span>}
        </span>
      </div>
      <div
        className={`mt-2 flex flex-wrap items-baseline gap-x-1 leading-6 font-semibold tabular-nums text-slate-100 ${compact ? "text-base" : "text-lg"}`}
      >
        {fmtNum(q.last)}{" "}
        <span className="text-xs font-normal text-slate-400">{q.unit}</span>
        <span className="ml-auto text-xs"><ChangeBadge pct={q.changePct} /></span>
      </div>
      {(q.future && q.future.last !== null) || q.cbr ? (
        <div
          className={`mt-1 space-y-0.5 border-t border-slate-800 pt-1 ${compact ? "text-[10px]" : "text-[11px]"}`}
        >
          {q.future && q.future.last !== null && (
            <div className="flex flex-wrap items-baseline justify-between gap-x-1">
              <span className="text-slate-400">Фьючерс</span>
              <span
                className={`font-medium text-slate-200 ${compact ? "text-xs" : "text-sm"}`}
              >
                {fmtNum(q.future.last)}{" "}
                <ChangeBadge pct={q.future.changePct} />
              </span>
            </div>
          )}
          {q.cbr && (
            <div className="flex flex-wrap items-baseline justify-between gap-x-1">
              <span className="text-slate-400">Курс ЦБ</span>
              <span
                className={`font-medium text-slate-200 ${compact ? "text-xs" : "text-sm"}`}
              >
                {fmtNum(q.cbr.value)} <ChangeBadge pct={q.cbr.changePct} />
              </span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StockRow({ q, compact }: { q: Quote; compact: boolean }) {
  return (
    <div title={quoteInfo(q)} className={`grid grid-cols-[minmax(0,1fr)_auto_4.6rem] items-center gap-x-2 rounded-lg border border-slate-800 bg-slate-900 px-3 tabular-nums ${compact ? "py-1.5" : "py-2.5"}`}>
      <div className="flex min-w-0 items-center gap-2">
        <StockLogo secid={q.secid} compact={compact} />
        <div className="min-w-0">
          <div className="break-words text-sm font-medium text-slate-100">{q.name}</div>
          <div className="text-[10px] tracking-wide text-slate-400">{q.secid}{q.cached && " · сохранено"}</div>
        </div>
      </div>
      <span className="whitespace-nowrap text-right text-sm font-semibold">{fmtNum(q.last)} ₽</span>
      <span className="text-right text-xs"><ChangeBadge pct={q.changePct} /></span>
    </div>
  );
}

// Плотная строка для топ-20 списков (акции/фьючерсы по обороту) в
// «Расширенном виде» — 40 позиций суммарно, полноразмерная StockRow тут
// была бы слишком высокой. Вторая метка — тикер акции или код контракта
// фьючерса (q.contract), цена без принудительного "₽" (у фьючерсов бывают
// другие единицы, а у общего топа по всем активам мы их не знаем).
function VolumeRow({ q }: { q: Quote }) {
  return (
    <div title={quoteInfo(q)} className="flex items-baseline justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <StockLogo secid={q.secid} compact />
        <span className="truncate text-sm font-medium text-slate-100">
          {q.name}{q.cached && <small> · сохранено</small>}
        </span>
        <span className="text-[10px] text-slate-500">
          {q.contract ?? q.secid}
        </span>
      </div>
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="text-sm font-semibold text-slate-100">
          {fmtNum(q.last)}
          {q.unit ? ` ${q.unit}` : ""}
        </span>
        <span className="text-xs">
          <ChangeBadge pct={q.changePct} />
        </span>
      </div>
    </div>
  );
}

function EmptyNote() {
  return <div className="text-sm text-slate-500">Нет данных</div>;
}

// --- Основной компонент ---

// Три режима отображения акций: «По отраслям» и «Топ20» требуют
// scope=full (весь борд TQBR), «Фишки» — только базовый набор.
const STOCK_VIEWS: { key: "sectors" | "chips" | "top20"; label: string }[] = [
  { key: "sectors", label: "По отраслям" },
  { key: "chips", label: "Фишки" },
  { key: "top20", label: "Топ20" },
];

export function MarketDashboard() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const isEditedRef = useRef(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const [stockView, setStockView] = useState<"chips" | "sectors" | "top20">(
    "chips",
  );
  // Что сейчас реально загружено в data — "full" содержит топ-20 по
  // обороту (акции+фьючерсы), "compact" — нет. Нужно, чтобы понять,
  // требуется ли догрузка при переключении на расширенный вид.
  const [dataScope, setDataScope] = useState<"compact" | "full" | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  const load = useCallback(
    async (regenerate: boolean, scope: "compact" | "full") => {
      setLoading(true);
      setError(null);
      try {
        // Компактный вид не показывает топ-20 по обороту — не запрашиваем
        // их (scope=full только когда реально нужны, при расширенном виде).
        // Ретраи и повтор по MOEX уже делает /api/market (плюс кэш) —
        // дублировать их тут не нужно, только увеличивает задержку.
        const res = await fetch(`/api/market${scope === "full" ? "?scope=full" : ""}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok || json.error) {
          throw new Error(json.error ?? "Ошибка загрузки");
        }
        const md = json as MarketResponse;
        try {
          const key = "market-calendar-v1:" + scope;
          const stored = localStorage.getItem(key);
          if (stored) restoreMissing(md, JSON.parse(stored));
          localStorage.setItem(key, JSON.stringify(md));
        } catch { /* Котировки доступны и без хранилища браузера. */ }
        setData(md);
        setDataScope(scope);
        // Перегенерируем комментарий только если пользователь его не правил
        // (или явно запросил сброс).
        if (regenerate || !isEditedRef.current) {
          setComment(generateCommentary(md));
          isEditedRef.current = false;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить данные");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Настоящего прогресса у /api/market нет — сколько осталось, зависит от
  // того, насколько сейчас тормозит MOEX/ALOR, узнать заранее нельзя.
  // Псевдопрогресс: ползёт к ~95% по асимптоте от типичного времени
  // загрузки (по наблюдениям — 5-15с), чтобы визуально было видно, что
  // процесс идёт и не завис, не обещая точное время, которого мы не знаем.
  useEffect(() => {
    if (!loading) return;
    setProgressPct(0);
    setElapsedSec(0);
    const startedAt = Date.now();
    const EXPECTED_MS = 13000;
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setElapsedSec(Math.floor(elapsed / 1000));
      setProgressPct(95 * (1 - Math.exp(-elapsed / EXPECTED_MS)));
    }, 200);
    return () => clearInterval(id);
  }, [loading]);

  // Плотность запоминается между открытиями (удобно для повторных скриншотов).
  useEffect(() => {
    const saved = localStorage.getItem("market-view");
    if (saved === "chips" || saved === "sectors" || saved === "top20") {
      setStockView(saved);
    }
  }, []);

  // Авто-высота textarea под содержимое.
  useLayoutEffect(() => {
    const el = commentRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [comment]);

  const now = new Date();
  const dateRu = now.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const dateRuCap = dateRu.charAt(0).toUpperCase() + dateRu.slice(1);
  const genTime = now.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const cbrDateRu = data?.cbrDate
    ? new Date(data.cbrDate).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
      })
    : null;

  // Плотная вёрстка (мелкие отступы/шрифты) — для всего, кроме «Топ20»,
  // где нужна ширина под два столбца. «max-w-2xl» — только у «Фишек»
  // (узкий скриншот-дружелюбный вид); «По отраслям» использует всю
  // ширину под сетку из 9 секторных блоков.
  const dense = stockView !== "top20";
  const narrow = stockView === "chips";

  return (
    <div className="min-h-screen bg-[#0b1220] px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-5xl">
        {/* Панель управления — вне зоны скриншота. Без гейта по data: иначе
            кнопку "Обновить" при первом заходе просто негде нажать. */}
        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          <Link
            href="/"
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700"
          >
            ← Календарь
          </Link>
          <button
            onClick={() =>
              void load(false, stockView === "chips" ? "compact" : "full")
            }
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            {loading ? `Обновление… ${elapsedSec}с` : "Обновить"}
          </button>
          <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-800 p-1">
            {STOCK_VIEWS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => {
                  setStockView(key);
                  localStorage.setItem("market-view", key);
                  // "По отраслям" и "Топ20" тянут весь борд TQBR (scope=full) —
                  // догружаем в фоне, если раньше грузили только компактный набор.
                  if (key !== "chips" && dataScope !== "full" && !loading) {
                    void load(false, "full");
                  }
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  stockView === key
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-300 hover:bg-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Link
            href="/ticker"
            className="ml-auto rounded-lg border border-transparent px-4 py-2 text-sm font-medium text-slate-400 transition hover:border-slate-700 hover:bg-slate-800 hover:text-slate-200"
          >
            Тикеры
          </Link>
          <Link
            href="/market/info"
            className="rounded-lg border border-transparent px-4 py-2 text-sm font-medium text-slate-400 transition hover:border-slate-700 hover:bg-slate-800 hover:text-slate-200"
          >
            Справочник
          </Link>
        </div>

        {/* Обновление, когда данные уже на экране — раньше единственной
            обратной связью было изменение текста кнопки на "Обновление…",
            без ощущения прогресса. Тот же псевдопрогресс-бар, что и на
            первой загрузке, просто в компактной строке под панелью кнопок
            вместо большого блока — данные под ним никуда не пропадают. */}
        {loading && data && (
          <div className="mb-4 flex items-center gap-3 print:hidden">
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400" />
            <div
              role="progressbar"
              aria-label="Обновление котировок"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.55)] transition-[width] duration-200 ease-linear"
                style={{ width: `${progressPct}%` }}
              >
                <div className="h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-white/50 to-transparent" />
              </div>
            </div>
            <span className="shrink-0 text-xs font-medium tabular-nums text-slate-400">
              {elapsedSec}с
            </span>
          </div>
        )}

        {/* Обновление после первого успешного захода упало, но старые
            данные ещё есть — раньше это было НЕВИДИМО (баннер ниже
            рендерится только когда data === null), кнопка просто молча
            возвращалась в "Обновить". Пользователь не понимал, почему
            "обновление не работает", и жал повторно вслепую. */}
        {error && data && (
          <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300 print:hidden">
            Не удалось обновить: {error}. Показаны данные последнего
            успешного обновления — попробуйте ещё раз.
          </div>
        )}

        {/* Ошибка */}
        {error && !data && (
          <div className="rounded-xl border border-red-900 bg-slate-900 p-6 text-center">
            <div className="text-lg font-medium text-red-400">
              Не удалось загрузить данные
            </div>
            <div className="mt-1 text-sm text-slate-400">{error}</div>
            <button
              onClick={() =>
                void load(true, stockView === "chips" ? "compact" : "full")
              }
              className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Повторить
            </button>
          </div>
        )}
        {/* Первая загрузка ещё не запрошена — автозагрузки на маунте нет
            намеренно: /api/market дёргает не только бесплатный MOEX, но и
            авторизованный токен ALOR, обновление — только по явному клику. */}
        {!loading && !data && !error && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center">
            <svg
              viewBox="0 0 160 48"
              className="mx-auto h-12 w-40 text-emerald-500/70"
              fill="none"
              aria-hidden
            >
              <path
                d="M4 34 L34 22 L58 30 L86 10 L112 20 L156 6"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                className="[stroke-dasharray:1] [stroke-dashoffset:1] animate-draw-line"
              />
            </svg>
            <div className="mt-4 text-lg font-medium text-slate-100">
              Котировки ещё не загружены
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Нажмите «
              <button
                type="button"
                onClick={() =>
                  void load(false, stockView === "chips" ? "compact" : "full")
                }
                className="text-base font-semibold text-emerald-400 underline decoration-emerald-400/40 underline-offset-2 transition hover:text-emerald-300 hover:decoration-emerald-300"
              >
                Обновить
              </button>
              », чтобы запросить актуальные данные.
            </p>
          </div>
        )}
        {/* Загрузка (первая или повторная после ошибки без старых данных) */}
        {loading && !data && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center">
            <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-slate-800" />
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-emerald-400 border-r-emerald-400/40" />
              <span className="text-sm font-semibold tabular-nums text-emerald-400">
                {elapsedSec}с
              </span>
            </div>
            <div className="mt-5 text-lg font-medium text-slate-100">
              Загружаем котировки
              <span className="ml-0.5 inline-flex">
                <span className="animate-bounce [animation-delay:-0.3s]">.</span>
                <span className="animate-bounce [animation-delay:-0.15s]">.</span>
                <span className="animate-bounce">.</span>
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Загрузка котировок"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="relative mx-auto mt-5 h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-800"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-emerald-500 shadow-[0_0_10px_rgba(52,211,153,0.6)] transition-[width] duration-200 ease-linear"
                style={{ width: `${progressPct}%` }}
              >
                <div className="h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-white/50 to-transparent" />
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-400">
              MOEX и ALOR иногда отвечают медленно — обычно занимает 5–15 секунд.
            </p>
          </div>
        )}

        {/* Зона дашборда (скриншотится) */}
        {data && (
          <div
            className={`rounded-2xl border border-slate-800 bg-[#0b1220] ${dense ? "p-4" : "p-6"}`}
          >
            {/* Шапка */}
            <header
              className={`flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 ${dense ? "pb-3" : "pb-4"}`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full bg-emerald-400" />
                  <h1
                    className={`font-bold text-slate-100 ${dense ? "text-lg" : "text-xl"}`}
                  >
                    Российский рынок · Обзор
                  </h1>
                </div>
                <div className="mt-1 text-sm text-slate-400">{dateRuCap}</div>
              </div>
              <div className="text-right text-xs text-slate-400">
                {data.moexTime && (
                  <div>Котировки на {data.moexTime.slice(0, 5)} МСК</div>
                )}
                {cbrDateRu && <div>Курсы ЦБ на {cbrDateRu}</div>}
              </div>
            </header>

            {/* Котировки: в узком (Фишки) режиме уже, чтобы убрать пустоту.
                Комментарий и подвал остаются на всю ширину. */}
            <div className={narrow ? "max-w-2xl" : ""}>
            {/* Индексы */}
            <section className={dense ? "mt-3" : "mt-5"}>
              {data.indices.length > 0 ? (
                <div
                  className={`grid grid-cols-1 sm:grid-cols-2 ${dense ? "gap-3" : "gap-4"}`}
                >
                  {data.indices.map((q) => (
                    <IndexCard
                      key={q.secid}
                      q={q}
                      compact={dense}
                      day={data.sparkDays?.[q.secid === "IMOEX" ? "imoex" : "rtsi"] ?? data.calendarDay}
                      historical={Boolean(data.sparkDays?.[q.secid === "IMOEX" ? "imoex" : "rtsi"] && data.sparkDays[q.secid === "IMOEX" ? "imoex" : "rtsi"] !== data.calendarDay)}
                      spark={
                        q.secid === "IMOEX"
                          ? data.sparklines.imoex
                          : data.sparklines.rtsi
                      }
                    />
                  ))}
                </div>
              ) : (
                <EmptyNote />
              )}
            </section>

            {/* Валюты и сырьё: всегда одна строка на 6 карточек в
                фиксированном порядке (Доллар, Евро, Юань, Золото, Нефть, Газ). */}
            <section className={dense ? "mt-3" : "mt-5"}>
              <h2
                className={`text-sm font-semibold uppercase tracking-wide text-slate-400 ${dense ? "mb-1.5" : "mb-2"}`}
              >
                Валюты и сырьё
              </h2>
              {data.currencies.length + data.commodities.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[...data.currencies, ...orderCommodities(data.commodities)].map(
                    (q) => (
                      <MiniCard key={q.secid} q={q} compact />
                    ),
                  )}
                </div>
              ) : (
                <EmptyNote />
              )}
            </section>

            {/* Акции: «Фишки» — фиксированный список (10 бумаг, для
                скриншотов); «По отраслям» — те же бумаги, сгруппированные по
                секторам IMOEX; «Топ20» — два столбца топ-20 по обороту (акции
                TQBR / ближайшие фьючерсы FORTS), независимо от STOCK_TICKERS. */}
            {stockView === "chips" ? (
              <section className="mt-3">
                <h2 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-400">
                  Голубые фишки
                </h2>
                {data.stocks.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {data.stocks.map((q) => (
                      <StockRow key={q.secid} q={q} compact />
                    ))}
                  </div>
                ) : (
                  <EmptyNote />
                )}
              </section>
            ) : stockView === "sectors" ? (
              <section className="mt-3">
                {loading && dataScope !== "full" ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400" />
                    Загружаем по отраслям…
                  </div>
                ) : data.sectorStocks.length > 0 ? (
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                    {data.sectorStocks.map((group) => (
                      <div key={group.sector}>
                        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {group.sector}
                        </h3>
                        <div className="space-y-1">
                          {group.quotes.map((q) => (
                            <VolumeRow key={q.secid} q={q} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyNote />
                )}
              </section>
            ) : (
              <section className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                    Акции · топ-20 по обороту
                    {data.rankingTimes?.topStocksByVolume && <small className="block normal-case">Рейтинг получен {new Date(data.rankingTimes.topStocksByVolume).toLocaleString("ru-RU", {timeZone:"Europe/Moscow"})} МСК</small>}
                  </h2>
                  {loading && dataScope !== "full" ? (
                    <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400" />
                      Загружаем топ-20…
                    </div>
                  ) : data.topStocksByVolume.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2">
                      {data.topStocksByVolume.map((q) => (
                        <VolumeRow key={q.secid} q={q} />
                      ))}
                    </div>
                  ) : (
                    <EmptyNote />
                  )}
                </div>
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                    Фьючерсы · топ-20 по обороту
                    {data.rankingTimes?.topFuturesByVolume && <small className="block normal-case">Рейтинг получен {new Date(data.rankingTimes.topFuturesByVolume).toLocaleString("ru-RU", {timeZone:"Europe/Moscow"})} МСК</small>}
                  </h2>
                  <p className="mb-2 text-[11px] text-slate-500">
                    Цена контракта как на бирже, без приведения к споту
                  </p>
                  {loading && dataScope !== "full" ? (
                    <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400" />
                      Загружаем топ-20…
                    </div>
                  ) : data.topFuturesByVolume.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2">
                      {data.topFuturesByVolume.map((q) => (
                        <VolumeRow key={q.secid} q={q} />
                      ))}
                    </div>
                  ) : (
                    <EmptyNote />
                  )}
                </div>
              </section>
            )}
            </div>

            {/* Комментарий */}
            <section className={dense ? "mt-3" : "mt-5"}>
              <h2
                className={`flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-400 ${dense ? "mb-1.5" : "mb-2"}`}
              >
                Комментарий
                <button
                  onClick={() => {
                    if (data) {
                      setComment(generateCommentary(data));
                      isEditedRef.current = false;
                    }
                  }}
                  disabled={!data}
                  title="Сбросить комментарий"
                  aria-label="Сбросить комментарий"
                  className="rounded-md p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300 disabled:opacity-40 disabled:hover:bg-transparent print:hidden"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                </button>
              </h2>
              <div
                className={`rounded-xl border border-slate-800 bg-slate-900 ${dense ? "p-3" : "p-4"}`}
              >
                <textarea
                  ref={commentRef}
                  value={comment}
                  onChange={(e) => {
                    setComment(e.target.value);
                    isEditedRef.current = true;
                  }}
                  rows={dense ? 2 : 3}
                  className="w-full resize-none border-none bg-transparent text-slate-100 focus:outline-none"
                  placeholder="Комментарий к рынку…"
                />
              </div>
            </section>

            {/* Подвал */}
            <footer
              className={`border-t border-slate-800 text-xs text-slate-500 ${dense ? "mt-3 pt-2" : "mt-5 pt-3"}`}
            >
              Источники: Т-Инвестиции, Алор, Московская биржа (ISS), ЦБ РФ · Не является
              индивидуальной инвестиционной рекомендацией · Сформировано в{" "}
              {genTime}
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
