"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MarketResponse, Quote } from "@/app/api/market/route";

// Фиксированная тёмная тема финансового терминала. Внутри «зоны скриншота»
// используются ТОЛЬКО жёстко закодированные Tailwind-классы (не семантические
// токены bg-background и т.п.) — иначе светлая тема приложения испортит скриншот.

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
}: {
  values: number[];
  color: string;
}) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 40;
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

function IndexCard({ q, spark }: { q: Quote; spark: number[] }) {
  const strokeColor =
    q.changePct === null || q.changePct === 0
      ? "#cbd5e1"
      : q.changePct > 0
        ? "#34d399"
        : "#f87171";
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm text-slate-400">{q.name}</div>
          <div className="mt-1 text-3xl font-bold text-slate-100">
            {fmtNum(q.last)}{" "}
            <span className="text-base font-normal text-slate-400">
              {q.unit}
            </span>
          </div>
          <div className="mt-1 text-lg">
            <ChangeBadge pct={q.changePct} />
          </div>
        </div>
        <Sparkline values={spark} color={strokeColor} />
      </div>
      <div className="mt-3 text-xs text-slate-400">
        Откр {fmtNum(q.open)} · Макс {fmtNum(q.high)} · Мин {fmtNum(q.low)}
      </div>
    </div>
  );
}

function MiniCard({ q }: { q: Quote }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="truncate text-xs text-slate-400" title={q.name}>
        {q.name}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-100">
        {fmtNum(q.last)}{" "}
        <span className="text-xs font-normal text-slate-400">{q.unit}</span>
      </div>
      <div className="mt-0.5 text-sm">
        <ChangeBadge pct={q.changePct} />
      </div>
    </div>
  );
}

function StockRow({ q }: { q: Quote }) {
  // Мини-полоска изменения: ширина ∝ |changePct|, потолок 5%.
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

function EmptyNote() {
  return <div className="text-sm text-slate-500">Нет данных</div>;
}

// --- Основной компонент ---

export function MarketDashboard() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const isEditedRef = useRef(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(
    async (regenerate: boolean) => {
      setLoading(true);
      setError(null);
      try {
        // Источники MOEX иногда отвечают частично; каждый запрос к /api/market
        // заново тянет данные, поэтому при пустых индексах/акциях повторяем.
        let md: MarketResponse | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await fetch("/api/market", { cache: "no-store" });
          const json = await res.json();
          if (!res.ok || json.error) {
            throw new Error(json.error ?? "Ошибка загрузки");
          }
          md = json as MarketResponse;
          if (md.indices.length > 0 && md.stocks.length > 0) break;
          if (attempt < 2) {
            const { promise, resolve } = Promise.withResolvers<void>();
            setTimeout(resolve, 800);
            await promise;
          }
        }
        if (!md) throw new Error("Не удалось загрузить данные");
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

  useEffect(() => {
    void load(true);
  }, [load]);

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
        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          <button
            onClick={() => void load(false)}
            disabled={loading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? "Обновление…" : "Обновить"}
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

        {/* Скелетон */}
        {loading && !data && !error && <DashboardSkeleton />}

        {/* Зона дашборда (скриншотится) */}
        {data && (
          <div className="rounded-2xl border border-slate-800 bg-[#0b1220] p-6">
            {/* Шапка */}
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full bg-emerald-400" />
                  <h1 className="text-xl font-bold text-slate-100">
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

            {/* Индексы */}
            <section className="mt-5">
              {data.indices.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {data.indices.map((q) => (
                    <IndexCard
                      key={q.secid}
                      q={q}
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
            <section className="mt-5">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Валюты и сырьё
              </h2>
              {data.currencies.length + data.commodities.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[...data.currencies, ...data.commodities].map((q) => (
                    <MiniCard key={q.secid} q={q} />
                  ))}
                </div>
              ) : (
                <EmptyNote />
              )}
            </section>

            {/* Акции */}
            <section className="mt-5">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Голубые фишки
              </h2>
              {data.stocks.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {data.stocks.map((q) => (
                    <StockRow key={q.secid} q={q} />
                  ))}
                </div>
              ) : (
                <EmptyNote />
              )}
            </section>

            {/* Комментарий */}
            <section className="mt-5">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Комментарий
              </h2>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <textarea
                  ref={commentRef}
                  value={comment}
                  onChange={(e) => {
                    setComment(e.target.value);
                    isEditedRef.current = true;
                  }}
                  rows={3}
                  className="w-full resize-none border-none bg-transparent text-slate-100 focus:outline-none"
                  placeholder="Комментарий к рынку…"
                />
              </div>
            </section>

            {/* Подвал */}
            <footer className="mt-5 border-t border-slate-800 pt-3 text-xs text-slate-500">
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

function DashboardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-800 bg-[#0b1220] p-6">
      <div className="h-8 w-64 rounded bg-slate-800" />
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="h-28 rounded-xl bg-slate-900" />
        <div className="h-28 rounded-xl bg-slate-900" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-slate-900" />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-slate-900" />
        ))}
      </div>
    </div>
  );
}
