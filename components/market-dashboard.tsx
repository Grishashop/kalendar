"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Coins, Droplet, Flame, Landmark, Globe } from "lucide-react";
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
  EUR_CBR: "🇪🇺",
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

function Sparkline({
  values,
  color,
  compact = false,
}: {
  values: number[];
  color: string;
  compact?: boolean;
}) {
  if (values.length < 2) return null;
  const w = compact ? 90 : 120;
  const h = compact ? 30 : 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="shrink-0"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// --- Карточки ---

function ChangeBadge({ pct }: { pct: number | null }) {
  return (
    <span className={`font-semibold ${changeColor(pct)}`}>
      {arrow(pct)} {fmtPct(pct)}
    </span>
  );
}

function IndexCard({
  q,
  spark,
  compact,
}: {
  q: IndexQuote;
  spark: number[];
  compact: boolean;
}) {
  const strokeColor =
    q.changePct === null || q.changePct === 0
      ? "#cbd5e1"
      : q.changePct > 0
        ? "#34d399"
        : "#f87171";
  return (
    <div
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
            {q.name}
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
          <div className={compact ? "mt-0.5 text-base" : "mt-1 text-lg"}>
            <ChangeBadge pct={q.changePct} />
          </div>
        </div>
        <Sparkline values={spark} color={strokeColor} compact={compact} />
      </div>
      <div
        className={`text-slate-400 ${compact ? "mt-2 text-[11px]" : "mt-3 text-xs"}`}
      >
        Откр {fmtNum(q.open)} · Макс {fmtNum(q.high)} · Мин {fmtNum(q.low)}
      </div>
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
            className={`text-slate-200 ${compact ? "text-xs" : "text-sm"}`}
          >
            {fmtNum(q.future.last)} п. <ChangeBadge pct={q.future.changePct} />
          </span>
        </div>
      )}
    </div>
  );
}

function MiniCard({ q, compact }: { q: Quote; compact: boolean }) {
  return (
    <div
      className={`rounded-xl border border-slate-800 bg-slate-900 ${compact ? "p-2" : "p-3"}`}
    >
      <div
        className="flex items-center gap-1.5 truncate text-xs text-slate-400"
        title={q.name}
      >
        <CurrencyFlag secid={q.secid} />
        <CommodityIcon name={q.name} />
        {q.name}
        {q.contract && <span className="text-slate-500"> · {q.contract}</span>}
      </div>
      <div
        className={`mt-1 font-semibold text-slate-100 ${compact ? "text-base" : "text-lg"}`}
      >
        {fmtNum(q.last)}{" "}
        <span className="text-xs font-normal text-slate-400">{q.unit}</span>
      </div>
      <div className={compact ? "text-xs" : "mt-0.5 text-sm"}>
        <ChangeBadge pct={q.changePct} />
      </div>
      {q.future && q.future.last !== null && (
        <div
          className={`mt-1 border-t border-slate-800 pt-1 text-slate-400 ${compact ? "text-[10px]" : "text-[11px]"}`}
        >
          Фьюч. {fmtNum(q.future.last)}{" "}
          <span className={changeColor(q.future.changePct)}>
            {fmtPct(q.future.changePct)}
          </span>
        </div>
      )}
    </div>
  );
}

function StockRow({ q, compact }: { q: Quote; compact: boolean }) {
  // Компактно: одна строка без полоски — минимум высоты, максимум плотности.
  if (compact) {
    return (
      <div className="flex items-baseline justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <StockLogo secid={q.secid} compact />
          <span className="truncate text-sm font-medium text-slate-100">
            {q.name}
          </span>
          <span className="text-[10px] text-slate-500">{q.secid}</span>
        </div>
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-100">
            {fmtNum(q.last)} ₽
          </span>
          <span className="text-xs">
            <ChangeBadge pct={q.changePct} />
          </span>
        </div>
      </div>
    );
  }
  // Расширенно: мини-полоска изменения, ширина ∝ |changePct|, потолок 5%.
  const magnitude =
    q.changePct === null ? 0 : Math.min(Math.abs(q.changePct), 5) / 5;
  const barColor =
    q.changePct === null || q.changePct === 0
      ? "bg-slate-600"
      : q.changePct > 0
        ? "bg-emerald-400"
        : "bg-red-400";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
      <StockLogo secid={q.secid} compact={false} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium text-slate-100">
            {q.name}
          </span>
          <span className="text-xs text-slate-500">{q.secid}</span>
        </div>
        <div className="mt-1 h-1 w-full overflow-hidden rounded bg-slate-800">
          <div
            className={`h-full ${barColor}`}
            style={{ width: `${magnitude * 100}%` }}
          />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-semibold text-slate-100">
          {fmtNum(q.last)} ₽
        </div>
        <div className="text-sm">
          <ChangeBadge pct={q.changePct} />
        </div>
      </div>
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
    <div className="flex items-baseline justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <StockLogo secid={q.secid} compact />
        <span className="truncate text-sm font-medium text-slate-100">
          {q.name}
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

export function MarketDashboard() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const isEditedRef = useRef(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const [compact, setCompact] = useState(false);

  const load = useCallback(
    async (regenerate: boolean) => {
      setLoading(true);
      setError(null);
      try {
        // Ретраи и переповтор по MOEX уже делает /api/market (плюс кэш на
        // 8с) — дублировать их тут не нужно, только увеличивает задержку.
        const res = await fetch("/api/market", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || json.error) {
          throw new Error(json.error ?? "Ошибка загрузки");
        }
        const md = json as MarketResponse;
        setData(md);
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

  // Данные грузим сразу при открытии страницы: /api/market теперь кэшируется
  // на 8с (CDN), так что автозагрузка не бьёт по MOEX на каждый визит.
  useEffect(() => {
    void load(false);
  }, [load]);

  // Плотность запоминается между открытиями (удобно для повторных скриншотов).
  useEffect(() => {
    if (localStorage.getItem("market-compact") === "1") setCompact(true);
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

  return (
    <div className="min-h-screen bg-[#0b1220] px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-5xl">
        {/* Панель управления — вне зоны скриншота */}
        {data && (
          <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          <button
            onClick={() => void load(false)}
            disabled={loading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? "Обновление…" : "Обновить"}
          </button>
          <button
            onClick={() =>
              setCompact((c) => {
                const next = !c;
                localStorage.setItem("market-compact", next ? "1" : "0");
                return next;
              })
            }
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700"
          >
            {compact ? "Расширенный вид" : "Компактный вид"}
          </button>
          <button
            onClick={() => {
              if (data) {
                setComment(generateCommentary(data));
                isEditedRef.current = false;
              }
            }}
            disabled={!data}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
          >
            Сбросить комментарий
          </button>
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
              onClick={() => void load(true)}
              className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Повторить
            </button>
          </div>
        )}
        {/* Первый заход и повторные обновления: спиннер до первых данных */}
        {!data && !error && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center">
            <div className="flex items-center justify-center gap-3">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-emerald-400" />
              <span className="text-lg font-medium text-slate-100">
                Загружаем котировки…
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Это может занять несколько секунд — подождите, пожалуйста.
            </p>
          </div>
        )}

        {/* Зона дашборда (скриншотится) */}
        {data && (
          <div
            className={`rounded-2xl border border-slate-800 bg-[#0b1220] ${compact ? "p-4" : "p-6"}`}
          >
            {/* Шапка */}
            <header
              className={`flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 ${compact ? "pb-3" : "pb-4"}`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full bg-emerald-400" />
                  <h1
                    className={`font-bold text-slate-100 ${compact ? "text-lg" : "text-xl"}`}
                  >
                    Российский рынок · Обзор
                  </h1>
                </div>
                <div className="mt-1 text-sm text-slate-400">{dateRuCap}</div>
              </div>
              <div className="text-right text-xs text-slate-400">
                {data.moexTime && (
                  <div>Данные MOEX на {data.moexTime.slice(0, 5)} МСК</div>
                )}
                {cbrDateRu && <div>Курсы ЦБ на {cbrDateRu}</div>}
              </div>
            </header>

            {/* Котировки: в компактном режиме уже, чтобы убрать пустоту.
                Комментарий и подвал остаются на всю ширину. */}
            <div className={compact ? "max-w-2xl" : ""}>
            {/* Индексы */}
            <section className={compact ? "mt-3" : "mt-5"}>
              {data.indices.length > 0 ? (
                <div
                  className={`grid grid-cols-1 sm:grid-cols-2 ${compact ? "gap-3" : "gap-4"}`}
                >
                  {data.indices.map((q) => (
                    <IndexCard
                      key={q.secid}
                      q={q}
                      compact={compact}
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

            {/* Валюты и сырьё */}
            <section className={compact ? "mt-3" : "mt-5"}>
              <h2
                className={`text-sm font-semibold uppercase tracking-wide text-slate-400 ${compact ? "mb-1.5" : "mb-2"}`}
              >
                Валюты и сырьё
              </h2>
              {data.currencies.length + data.commodities.length > 0 ? (
                <div
                  className={
                    compact
                      ? "grid grid-cols-3 gap-3"
                      : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
                  }
                >
                  {[...data.currencies, ...data.commodities].map((q) => (
                    <MiniCard key={q.secid} q={q} compact={compact} />
                  ))}
                </div>
              ) : (
                <EmptyNote />
              )}
            </section>

            {/* Акции: компактный вид — фиксированные "голубые фишки" (10 бумаг,
                для скриншотов); расширенный вид — два столбца топ-20 по обороту
                (акции TQBR / ближайшие фьючерсы FORTS), независимо от
                STOCK_TICKERS. */}
            {compact ? (
              <section className="mt-3">
                <h2 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-400">
                  Голубые фишки
                </h2>
                {data.stocks.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {data.stocks.map((q) => (
                      <StockRow key={q.secid} q={q} compact={compact} />
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
                  </h2>
                  {data.topStocksByVolume.length > 0 ? (
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
                  </h2>
                  <p className="mb-2 text-[11px] text-slate-500">
                    Цена контракта как на бирже, без приведения к споту
                  </p>
                  {data.topFuturesByVolume.length > 0 ? (
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
            <section className={compact ? "mt-3" : "mt-5"}>
              <h2
                className={`text-sm font-semibold uppercase tracking-wide text-slate-400 ${compact ? "mb-1.5" : "mb-2"}`}
              >
                Комментарий
              </h2>
              <div
                className={`rounded-xl border border-slate-800 bg-slate-900 ${compact ? "p-3" : "p-4"}`}
              >
                <textarea
                  ref={commentRef}
                  value={comment}
                  onChange={(e) => {
                    setComment(e.target.value);
                    isEditedRef.current = true;
                  }}
                  rows={compact ? 2 : 3}
                  className="w-full resize-none border-none bg-transparent text-slate-100 focus:outline-none"
                  placeholder="Комментарий к рынку…"
                />
              </div>
            </section>

            {/* Подвал */}
            <footer
              className={`border-t border-slate-800 text-xs text-slate-500 ${compact ? "mt-3 pt-2" : "mt-5 pt-3"}`}
            >
              Источники: Московская биржа (ISS), ЦБ РФ · Не является
              индивидуальной инвестиционной рекомендацией · Сформировано в{" "}
              {genTime}
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
