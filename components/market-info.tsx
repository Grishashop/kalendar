"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SearchResponse, SearchResult } from "@/app/api/market/search/route";
import type { InfoResponse } from "@/app/api/market/info/route";
import type { EventsResponse } from "@/app/api/market/events/route";

// Справочник МосБиржи: поиск любого инструмента + карточка-«паспорт» +
// сводные события. Та же фиксированная тёмная тема, что у market-dashboard.tsx
// (жёстко закодированные Tailwind-классы, без семантических токенов).

// --- Форматирование (ru-RU) — локальные копии хелперов market-dashboard.tsx,
// сознательно не импортируются оттуда (дашборд остаётся нетронутым). ---

function fmtNum(v: number | null, maxFrac = 2): string {
  if (v === null) return "—";
  return v.toLocaleString("ru-RU", { maximumFractionDigits: maxFrac });
}

// Значения спецификации (шаг цены, лоты и т.п.) требуют больше знаков
// после запятой, чем обычные котировки — иначе мелкий шаг цены (0,0001)
// округлится до нуля.
function fmtSpecNum(v: number): string {
  return v.toLocaleString("ru-RU", { maximumFractionDigits: 6 });
}

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

function fmtDate(s: string): string {
  if (!s || s.length < 10) return s || "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

// --- Метки ISS-групп для группировки результатов поиска ---

const GROUP_LABELS: Record<string, string> = {
  stock_shares: "Акции",
  stock_bonds: "Облигации",
  futures_forts: "Фьючерсы",
  futures_options: "Опционы",
  stock_index: "Индексы",
  currency_selt: "Валюта",
  stock_etf: "ETF",
  stock_ppif: "БПИФ",
  stock_dr: "Расписки",
};

function groupLabel(group: string): string {
  return GROUP_LABELS[group] ?? group ?? "Прочее";
}

function groupResults(results: SearchResult[]): { label: string; items: SearchResult[] }[] {
  const order: string[] = [];
  const map = new Map<string, SearchResult[]>();
  for (const r of results) {
    const label = groupLabel(r.group);
    if (!map.has(label)) {
      map.set(label, []);
      order.push(label);
    }
    map.get(label)!.push(r);
  }
  return order.map((label) => ({ label, items: map.get(label)! }));
}

// Полный список типов инструментов для фильтра поиска — всегда виден целиком,
// не зависит от того, что нашлось по текущему запросу.
const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Все" },
  ...Object.entries(GROUP_LABELS).map(([key, label]) => ({ key, label })),
];

// --- Расписание торгов (статично, зафиксировано на 2026 г. по moex.com) ---

function TradingSchedule() {
  return (
    <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Расписание торгов
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="text-sm font-medium text-slate-200">Фондовый рынок</div>
          <ul className="mt-1 space-y-0.5 text-sm text-slate-400">
            <li>Основная сессия: 09:50–19:00</li>
            <li>Вечерняя сессия: 19:00–23:50</li>
            <li>Сессии выходного дня: 09:50–19:00</li>
          </ul>
        </div>
        <div>
          <div className="text-sm font-medium text-slate-200">Срочный рынок</div>
          <ul className="mt-1 space-y-0.5 text-sm text-slate-400">
            <li>Аукцион открытия: 08:50–09:00</li>
            <li>Утренняя доп. сессия: 09:00–10:00</li>
            <li>Основная сессия: 10:00–19:00</li>
            <li>Вечерняя доп. сессия: 19:00–23:50</li>
            <li>Сессии выходного дня: 09:50–19:00</li>
          </ul>
          <p className="mt-1 text-xs text-slate-500">
            С 23.03.2026 действует единая торговая сессия — торги идут без остановки на
            промежуточный клиринг.
          </p>
        </div>
        <div>
          <div className="text-sm font-medium text-slate-200">Валютный рынок</div>
          <ul className="mt-1 space-y-0.5 text-sm text-slate-400">
            <li>Аукцион открытия: 09:50</li>
            <li>Основная сессия: 10:00–19:00</li>
            <li>Режим TOD — до 17:45, своп/овернайт — до 18:00, TOM/SPT — до 19:00</li>
          </ul>
        </div>
        <div>
          <div className="text-sm font-medium text-slate-200">Праздники 2026 (торгов нет)</div>
          <ul className="mt-1 space-y-0.5 text-sm text-slate-400">
            <li>1–2 января, 7 января, 8 марта, 9 мая, 31 декабря</li>
          </ul>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        Расписание фиксировано на 2026 г., источник — moex.com.
      </p>
    </section>
  );
}

export function MarketInfo() {
  // --- Поиск ---
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const blurTimer = useRef<NodeJS.Timeout | null>(null);

  // --- Карточка инструмента ---
  const [selectedSecid, setSelectedSecid] = useState<string | null>(null);
  const [info, setInfo] = useState<InfoResponse | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  // --- События ---
  const [events, setEvents] = useState<EventsResponse | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string) => {
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Ошибка поиска");
      setResults((json as SearchResponse).results);
      setSearchOpen(true);
    } catch {
      setResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Очистка при стирании запроса — сам поиск теперь только по Enter
  // (см. onKeyDown на input), без автопоиска на каждое нажатие клавиши.
  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      setSearchOpen(false);
    }
  }, [query]);

  const loadInfo = useCallback(async (secid: string) => {
    setInfoLoading(true);
    setInfoError(null);
    try {
      const res = await fetch(`/api/market/info?secid=${encodeURIComponent(secid)}`);
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Ошибка загрузки");
      setInfo(json as InfoResponse);
    } catch (e) {
      setInfoError(e instanceof Error ? e.message : "Не удалось загрузить данные");
    } finally {
      setInfoLoading(false);
    }
  }, []);

  const selectInstrument = useCallback(
    (r: SearchResult) => {
      setSearchOpen(false);
      setQuery(r.shortname);
      setSelectedSecid(r.secid);
      history.replaceState(null, "", `/market/info?secid=${encodeURIComponent(r.secid)}`);
      void loadInfo(r.secid);
    },
    [loadInfo],
  );

  // Deep-link: /market/info?secid=SBER сразу открывает карточку.
  useEffect(() => {
    const secid = new URLSearchParams(window.location.search).get("secid");
    if (secid) {
      setSelectedSecid(secid);
      void loadInfo(secid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const res = await fetch("/api/market/events");
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Ошибка загрузки");
      setEvents(json as EventsResponse);
    } catch (e) {
      setEventsError(e instanceof Error ? e.message : "Не удалось загрузить данные");
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const filteredResults =
    typeFilter === "all" ? results : results.filter((r) => r.group === typeFilter);
  const groups = groupResults(filteredResults);

  return (
    <div className="min-h-screen bg-[#0b1220] px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-5xl">
        {/* Шапка */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-slate-100">Справочник МосБиржи</h1>
          <Link
            href="/market"
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700"
          >
            ← Обзор рынка
          </Link>
        </div>

        {/* Поиск */}
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const q = query.trim();
              if (q.length >= 2) void runSearch(q);
            }}
            onFocus={() => {
              if (results.length > 0) setSearchOpen(true);
            }}
            onBlur={() => {
              // Небольшая задержка — иначе onBlur закрывает список раньше,
              // чем успевает сработать onClick по строке результата/фильтра.
              blurTimer.current = setTimeout(() => setSearchOpen(false), 150);
            }}
            placeholder="Тикер, ISIN или название — Enter для поиска…"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-600 focus:outline-none"
          />
          {/* Фильтр по типу инструмента — виден всегда, не только при открытом
              выпадающем списке результатов. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setTypeFilter(f.key);
                  if (blurTimer.current) {
                    clearTimeout(blurTimer.current);
                    blurTimer.current = null;
                  }
                  if (results.length > 0) setSearchOpen(true);
                }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  typeFilter === f.key
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {searchOpen && (
            <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
              {groups.length === 0 && (
                <div className="px-3 py-3 text-sm text-slate-500">Нет результатов</div>
              )}
              {groups.map((g) => (
                <div key={g.label}>
                  <div className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {g.label}
                  </div>
                  {g.items.map((r) => (
                    <button
                      key={r.secid}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (blurTimer.current) {
                          clearTimeout(blurTimer.current);
                          blurTimer.current = null;
                        }
                        selectInstrument(r);
                      }}
                      className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-slate-800 ${
                        r.isTraded ? "" : "opacity-60"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-100">{r.shortname}</span>
                        <span className="text-xs text-slate-500">{r.secid}</span>
                        {!r.isTraded && (
                          <span className="text-[10px] text-slate-500">не торгуется</span>
                        )}
                      </span>
                      <span className="truncate text-xs text-slate-400">{r.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {searchLoading && (
            <div className="absolute right-3 top-2.5 text-xs text-slate-500">Поиск…</div>
          )}
        </div>

        {/* Карточка инструмента */}
        {(infoLoading || info || infoError) && (
          <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-5">
            {infoLoading && !info && (
              <div className="text-sm text-slate-400">Загрузка…</div>
            )}
            {infoError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                {infoError}
                <button
                  onClick={() => selectedSecid && void loadInfo(selectedSecid)}
                  className="ml-3 rounded-md border border-red-800 px-2 py-1 text-xs text-red-200 hover:bg-red-900/40"
                >
                  Повторить
                </button>
              </div>
            )}
            {info && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-100">{info.name}</h2>
                      <span className="text-sm text-slate-500">{info.secid}</span>
                      {info.typeName && (
                        <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
                          {info.typeName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {info.quote ? (
                      <>
                        <div className="text-2xl font-semibold text-slate-100">
                          {fmtNum(info.quote.last)}
                        </div>
                        <div className={`text-sm font-medium ${changeColor(info.quote.changePct)}`}>
                          {fmtPct(info.quote.changePct)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          О {fmtNum(info.quote.open)} · В {fmtNum(info.quote.high)} · Н{" "}
                          {fmtNum(info.quote.low)}
                          {info.quote.updatetime ? ` · ${info.quote.updatetime}` : ""}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-slate-500">Нет торговых данных</div>
                    )}
                  </div>
                </div>

                {info.spec && (
                  <div className="mt-5">
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                      Спецификация
                    </h3>
                    <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                      {info.spec.map((row) => (
                        <div
                          key={row.label}
                          className="flex items-center justify-between gap-3 border-b border-slate-800/60 py-1 text-sm"
                        >
                          <span className="text-slate-400">{row.label}</span>
                          <span className="text-slate-100">
                            {typeof row.value === "number" ? fmtSpecNum(row.value) : row.value}
                            {row.unit ? ` ${row.unit}` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {info.dividends && info.dividends.length > 0 && (
                  <div className="mt-5">
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                      Дивиденды
                    </h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="pb-1 font-medium">Дата закрытия реестра</th>
                          <th className="pb-1 font-medium">Дивиденд</th>
                          <th className="pb-1 font-medium">Валюта</th>
                        </tr>
                      </thead>
                      <tbody>
                        {info.dividends.slice(0, 12).map((d, i) => {
                          const isUpcoming = d.date >= new Date().toISOString().slice(0, 10);
                          return (
                            <tr
                              key={`${d.date}-${i}`}
                              className={`border-t border-slate-800/60 ${
                                isUpcoming ? "text-emerald-400" : "text-slate-200"
                              }`}
                            >
                              <td className="py-1">{fmtDate(d.date)}</td>
                              <td className="py-1">{fmtNum(d.value, 4)}</td>
                              <td className="py-1">{d.currency}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <details className="mt-5 rounded-lg border border-slate-800">
                  <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200">
                    Паспорт инструмента
                  </summary>
                  <div className="grid grid-cols-1 gap-x-6 px-3 pb-3 sm:grid-cols-2">
                    {info.passport.map((row, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-3 border-b border-slate-800/60 py-1 text-sm"
                      >
                        <span className="text-slate-400">{row.title}</span>
                        <span className="break-all text-slate-100">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </details>
              </>
            )}
          </section>
        )}

        {/* События */}
        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Ближайшие дивиденды
            </h2>
            {eventsLoading && <div className="text-sm text-slate-400">Загрузка…</div>}
            {eventsError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                {eventsError}
                <button
                  onClick={() => void loadEvents()}
                  className="ml-3 rounded-md border border-red-800 px-2 py-1 text-xs text-red-200 hover:bg-red-900/40"
                >
                  Повторить
                </button>
              </div>
            )}
            {events &&
              (() => {
                const upcoming = events.dividends.upcoming;
                const showRecent = upcoming.length === 0;
                const rows = showRecent ? events.dividends.recent : upcoming;
                return (
                  <>
                    {showRecent && (
                      <p className="mb-2 text-xs text-slate-500">
                        Ближайших объявленных нет — последние выплаты
                      </p>
                    )}
                    {rows.length > 0 ? (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                            <th className="pb-1 font-medium">Бумага</th>
                            <th className="pb-1 font-medium">Дата закрытия реестра</th>
                            <th className="pb-1 font-medium">Дивиденд</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((d, i) => (
                            <tr key={`${d.secid}-${d.date}-${i}`} className="border-t border-slate-800/60">
                              <td className="py-1">
                                <span className="font-medium text-slate-100">{d.secid}</span>{" "}
                                <span className="text-slate-500">{d.name}</span>
                              </td>
                              <td className="py-1">{fmtDate(d.date)}</td>
                              <td className="py-1">
                                {fmtNum(d.value, 4)} {d.currency}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="text-sm text-slate-500">Нет данных</div>
                    )}
                  </>
                );
              })()}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Экспирации фьючерсов
            </h2>
            {eventsLoading && <div className="text-sm text-slate-400">Загрузка…</div>}
            {events && (
              events.expirations.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="pb-1 font-medium">Контракт</th>
                      <th className="pb-1 font-medium">Код</th>
                      <th className="pb-1 font-medium">Базовый актив</th>
                      <th className="pb-1 font-medium">Последний торг. день</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.expirations.slice(0, 15).map((e) => (
                      <tr key={e.secid} className="border-t border-slate-800/60">
                        <td className="py-1 text-slate-100">{e.shortName}</td>
                        <td className="py-1 text-slate-500">{e.secid}</td>
                        <td className="py-1">{e.name}</td>
                        <td className="py-1">{fmtDate(e.lastTradeDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-sm text-slate-500">Нет данных</div>
              )
            )}
          </div>
        </section>

        <TradingSchedule />
      </div>
    </div>
  );
}
