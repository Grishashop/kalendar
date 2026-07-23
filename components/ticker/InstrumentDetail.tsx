"use client";

import { useEffect, useRef, useState } from "react";
import type { Candle, Coupon, CouponSchedule, Dividend, Quote, SecuritySearchResult, WatchItem } from "@/lib/ticker/instruments";
import {
  changeColorClass,
  decimalsFromMinstep,
  fmtDate,
  fmtPercent,
  fmtPrice,
  fmtSigned,
  fmtTime,
  kindLabel,
  moexUrl,
} from "@/lib/ticker/instruments";
import { InstrumentIcon } from "@/components/ticker/InstrumentIcon";
import { CandleChart } from "@/components/ticker/CandleChart";
import { Collapsible } from "@/components/ticker/Collapsible";

const FLASH_DURATION_MS = 500;
const COPY_RESET_MS = 1500;
const POP_DURATION_MS = 200;

/** "0,00" в Bid/Ask/объёме — не реальный ноль, а "нет тика" (рынок закрыт, свежий листинг).
 *  Показываем "—", иначе продавец на телефоне читает клиенту буквальный нулевой спрос. */
function fmtPriceOrDash(value: number, decimals: number): string {
  return value === 0 ? "—" : fmtPrice(value, decimals);
}
function fmtIntOrDash(value: number): string {
  return value === 0 ? "—" : new Intl.NumberFormat("ru-RU").format(value);
}

function CopyableValue({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [popping, setPopping] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setPopping(true);
        setTimeout(() => setCopied(false), COPY_RESET_MS);
        setTimeout(() => setPopping(false), POP_DURATION_MS);
      }}
      title="Нажмите, чтобы скопировать"
      className={`${className ?? ""} inline-block cursor-pointer text-left hover:text-zinc-100 ${popping ? "animate-pop" : ""}`}
    >
      {copied ? "Скопировано ✓" : value}
    </button>
  );
}

/** Заголовок раздела карточки — визуальный якорь при беглом сканировании (иначе все блоки
 *  статистики визуально неотличимы друг от друга, приходится читать всё подряд). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 border-t border-zinc-800 pt-6">
      <div className="mb-3 text-[11px] font-medium tracking-wide text-zinc-600 uppercase">{title}</div>
      {children}
    </div>
  );
}

function StatGrid({ entries }: { entries: [string, string, string?][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
      {entries.map(([label, value, valueClassName]) => (
        <div key={label}>
          <div className="text-zinc-500">{label}</div>
          <div className={`font-medium ${valueClassName ?? "text-zinc-100"}`}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function InstrumentCandles({
  exchange,
  symbol,
  decimals,
  quote,
}: {
  exchange: string;
  symbol: string;
  decimals: number;
  quote: Quote | undefined;
}) {
  const [candles, setCandles] = useState<Candle[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ticker/history?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Candle[]) => {
        if (!cancelled) setCandles(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setCandles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [exchange, symbol]);

  // Дневная свеча запрашивается один раз при выборе инструмента и дальше не обновляется —
  // без этого последний бар графика "застывает" и расходится с живой карточкой (Мин./Макс. дня),
  // которая продолжает обновляться по WS/поллингу. Подменяем последний бар текущими значениями
  // котировки, чтобы график и карточка всегда показывали одно и то же.
  const displayCandles =
    candles && candles.length > 0 && quote
      ? [
          ...candles.slice(0, -1),
          {
            time: candles[candles.length - 1].time,
            open: quote.open_price,
            high: quote.high_price,
            low: quote.low_price,
            close: quote.last_price,
            volume: quote.volume,
          },
        ]
      : candles;

  return <CandleChart candles={displayCandles} decimals={decimals} />;
}

function InstrumentRiskInfo({
  symbol,
  decimals,
  currency,
  showMargin,
}: {
  symbol: string;
  decimals: number;
  currency: string;
  showMargin: boolean;
}) {
  const [info, setInfo] = useState<SecuritySearchResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ticker/security?symbol=${encodeURIComponent(symbol)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SecuritySearchResult | null) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (info === null) return null;

  const entries: [string, string][] = [];
  if (info.priceMin !== null && info.priceMax !== null) {
    entries.push([
      "Ценовой коридор",
      `${fmtPrice(info.priceMin, decimals)} – ${fmtPrice(info.priceMax, decimals)} ${currency}`,
    ]);
  }
  if (showMargin && info.marginbuy !== null && info.marginbuy > 0) {
    entries.push(["ГО покупка", `${fmtPrice(info.marginbuy, 2)} ${currency}`]);
  }
  if (showMargin && info.marginsell !== null && info.marginsell > 0) {
    entries.push(["ГО продажа", `${fmtPrice(info.marginsell, 2)} ${currency}`]);
  }

  if (entries.length === 0) return null;

  return (
    <Section title="Лимиты и границы цены">
      <StatGrid entries={entries} />
    </Section>
  );
}

function InstrumentExtraInfo({ item }: { item: WatchItem }) {
  const [dividends, setDividends] = useState<Dividend[] | null>(null);
  const [schedule, setSchedule] = useState<CouponSchedule | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (item.kind === "stock") {
      fetch(`/api/ticker/dividends?symbol=${encodeURIComponent(item.symbol)}`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data: Dividend[]) => {
          if (!cancelled) setDividends(Array.isArray(data) ? data : []);
        })
        .catch(() => {
          if (!cancelled) setDividends([]);
        });
    } else if (item.kind === "bond") {
      fetch(`/api/ticker/coupons?symbol=${encodeURIComponent(item.symbol)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: CouponSchedule | null) => {
          if (!cancelled) setSchedule(data ?? { coupons: [], amortizations: [] });
        })
        .catch(() => {
          if (!cancelled) setSchedule({ coupons: [], amortizations: [] });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [item.symbol, item.kind]);

  function couponRow(coupon: Coupon) {
    return (
      <tr key={coupon.couponDate} className="border-t border-zinc-800">
        <td className="px-2 py-1.5 text-zinc-300">{fmtDate(coupon.couponDate)}</td>
        <td className="px-2 py-1.5 text-right text-zinc-400">{fmtPrice(coupon.valuePercent, 2)} %</td>
        <td className="px-2 py-1.5 text-right text-zinc-100">{fmtPrice(coupon.value, 2)}</td>
      </tr>
    );
  }

  return (
    <Section title="Дополнительная информация">
      {item.kind === "stock" &&
        (dividends === null ? (
          <div className="h-16 animate-pulse rounded bg-zinc-800" />
        ) : dividends.length === 0 ? (
          <p className="text-sm text-zinc-500">Нет данных о дивидендах</p>
        ) : (
          <div className="max-h-48 overflow-y-auto rounded border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                <tr>
                  <th className="px-2 py-1.5 text-left font-normal">Закрытие реестра</th>
                  <th className="px-2 py-1.5 text-right font-normal">На акцию</th>
                </tr>
              </thead>
              <tbody>
                {dividends.map((dividend) => (
                  <tr key={dividend.registryCloseDate} className="border-t border-zinc-800">
                    <td className="px-2 py-1.5 text-zinc-300">{fmtDate(dividend.registryCloseDate)}</td>
                    <td className="px-2 py-1.5 text-right text-zinc-100">
                      {fmtPrice(dividend.value, 2)} {dividend.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {item.kind === "bond" &&
        (schedule === null ? (
          <div className="h-16 animate-pulse rounded bg-zinc-800" />
        ) : schedule.coupons.length === 0 && schedule.amortizations.length === 0 ? (
          <p className="text-sm text-zinc-500">Нет данных о купонах</p>
        ) : (
          <div className="flex flex-col gap-3">
            {schedule.coupons.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded border border-zinc-800">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-normal">Купон</th>
                      <th className="px-2 py-1.5 text-right font-normal">Ставка</th>
                      <th className="px-2 py-1.5 text-right font-normal">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>{schedule.coupons.map(couponRow)}</tbody>
                </table>
              </div>
            )}
            {schedule.amortizations.length > 0 && (
              <div className="rounded border border-zinc-800">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-900 text-zinc-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-normal">Погашение номинала</th>
                      <th className="px-2 py-1.5 text-right font-normal">Доля</th>
                      <th className="px-2 py-1.5 text-right font-normal">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.amortizations.map((amortization) => (
                      <tr key={amortization.amortDate} className="border-t border-zinc-800">
                        <td className="px-2 py-1.5 text-zinc-300">{fmtDate(amortization.amortDate)}</td>
                        <td className="px-2 py-1.5 text-right text-zinc-400">
                          {fmtPrice(amortization.valuePercent, 2)} %
                        </td>
                        <td className="px-2 py-1.5 text-right text-amber-400">
                          {fmtPrice(amortization.value, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}

      {item.kind === "futures" && (
        <p className="text-sm text-zinc-500">Для фьючерсов дивиденды и купоны не предусмотрены.</p>
      )}

      <a
        href={moexUrl(item)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300"
      >
        Подробнее на MOEX →
      </a>
    </Section>
  );
}

function FuturesUnderlying({ item, refreshToken }: { item: WatchItem; refreshToken: number }) {
  const [quote, setQuote] = useState<Quote | null | undefined>(undefined);
  const baseSymbol = item.symbol.split("-")[0];

  useEffect(() => {
    if (!item.underlyingName) return;
    let cancelled = false;
    fetch(`/api/ticker/quotes?symbols=${encodeURIComponent(`${item.exchange}:${baseSymbol}`)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Quote[]) => {
        if (!cancelled) setQuote(Array.isArray(data) && data[0] ? data[0] : null);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [item.symbol, item.underlyingName, item.exchange, baseSymbol, refreshToken]);

  if (!item.underlyingName) return null;

  return (
    <Section title={`Базовый актив: ${item.underlyingName}`}>
      {quote === undefined ? (
        <div className="h-10 animate-pulse rounded bg-zinc-800" />
      ) : quote === null ? (
        <p className="text-sm text-zinc-500">Не удалось загрузить котировку базового актива</p>
      ) : (
        <StatGrid
          entries={[
            ["Цена", fmtPrice(quote.last_price, 2)],
            [
              "Изменение",
              `${fmtSigned(quote.change, 2)} (${fmtPercent(quote.change_percent)})`,
              changeColorClass(quote.change),
            ],
            ["Bid / Ask", `${fmtPriceOrDash(quote.bid, 2)} / ${fmtPriceOrDash(quote.ask, 2)}`],
          ]}
        />
      )}
    </Section>
  );
}

interface InstrumentDetailProps {
  item: WatchItem;
  quote: Quote | undefined;
  loading: boolean;
  onRemove: () => void;
  onRefresh: () => void;
  refreshToken: number;
}

export function InstrumentDetail({ item, quote, loading, onRemove, onRefresh, refreshToken }: InstrumentDetailProps) {
  const decimals = decimalsFromMinstep(item.minstep);
  // Направление последней вспышки цены — вспышка красится в цвет движения (не просто
  // серый фон всей карточки), чтобы направление считывалось боковым зрением без чтения знака.
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const prevPriceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    prevPriceRef.current = undefined;
  }, [item.exchange, item.symbol]);

  useEffect(() => {
    if (quote === undefined) return;
    const prev = prevPriceRef.current;
    prevPriceRef.current = quote.last_price;
    if (prev === undefined || prev === quote.last_price) return;
    setFlash(quote.last_price > prev ? "up" : "down");
    const timer = setTimeout(() => setFlash(null), FLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [quote]);

  const maturityDate = fmtDate(item.cancellation);

  return (
    <div className="animate-fade-in rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex flex-wrap items-start gap-x-2 gap-y-3">
        <div className="flex items-center gap-3">
          <InstrumentIcon kind={item.kind} symbol={item.symbol} shortname={item.shortname} size="md" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-zinc-100">{item.shortname}</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                {kindLabel(item.kind)}
              </span>
            </div>
            <div className="text-sm text-zinc-500">
              {item.symbol} · {item.exchange}
            </div>
            {item.description && item.description !== item.shortname && (
              <div className="text-sm text-zinc-400">{item.description}</div>
            )}
          </div>
        </div>
        {item.isin && (
          <div className="flex items-center gap-2 self-center text-sm">
            <span className="text-zinc-500">ISIN</span>
            <CopyableValue value={item.isin} className="font-mono text-zinc-300" />
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setShowInfo((value) => !value)}
            aria-label="Дополнительная информация"
            aria-pressed={showInfo}
            className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium transition-colors ${
              showInfo ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
          >
            i
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Обновить котировку"
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading && (
              <svg className="h-3 w-3 animate-spin text-zinc-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {loading ? "Обновляем…" : "Обновить"}
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Удалить из списка"
            className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            ✕
          </button>
        </div>
      </div>

      {quote === undefined ? (
        <div className="mb-6 h-10 w-40 animate-pulse rounded bg-zinc-800" />
      ) : (
        <div
          className={`mb-6 flex items-baseline gap-3 rounded-md px-2 py-1 -mx-2 transition-colors duration-500 ${
            flash === "up" ? "bg-emerald-500/15" : flash === "down" ? "bg-red-500/15" : ""
          }`}
        >
          <span className="text-4xl font-bold tabular-nums text-zinc-50">
            {fmtPrice(quote.last_price, decimals)}
          </span>
          <span className={`text-lg font-medium tabular-nums ${changeColorClass(quote.change)}`}>
            {fmtSigned(quote.change, decimals)} ({fmtPercent(quote.change_percent)})
          </span>
        </div>
      )}

      {quote === undefined ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-zinc-800" />
          ))}
        </div>
      ) : (
        <StatGrid
          entries={[
            ["Время сделки", fmtTime(quote.last_price_timestamp)],
            ["Bid / Ask", `${fmtPriceOrDash(quote.bid, decimals)} / ${fmtPriceOrDash(quote.ask, decimals)}`],
            ["Лот", `${new Intl.NumberFormat("ru-RU").format(quote.lotsize)} шт · ${fmtPrice(quote.lotvalue, decimals)} ${item.currency}`],
            ["Закрытие вчера", fmtPrice(quote.prev_close_price, decimals)],
            ["Открытие", fmtPrice(quote.open_price, decimals)],
            ["Объём", fmtIntOrDash(quote.volume)],
            ["Мин. дня", fmtPrice(quote.low_price, decimals), "text-red-400"],
            ["Макс. дня", fmtPrice(quote.high_price, decimals), "text-emerald-400"],
          ]}
        />
      )}

      <Section title="График">
        <InstrumentCandles exchange={item.exchange} symbol={item.symbol} decimals={decimals} quote={quote} />
      </Section>

      {quote !== undefined && (
        <Section title="Ликвидность">
          <StatGrid
            entries={[
              ["Bid объём", fmtIntOrDash(quote.bid_vol)],
              ["Ask объём", fmtIntOrDash(quote.ask_vol)],
              ["Спрос / предложение", `${fmtIntOrDash(quote.total_bid_vol)} / ${fmtIntOrDash(quote.total_ask_vol)}`],
            ]}
          />
        </Section>
      )}

      {item.kind === "bond" && quote !== undefined && (
        <Section title="Параметры выпуска">
          <StatGrid
            entries={[
              [
                "Цена",
                `${fmtPrice(quote.last_price, 2)} % ≈ ${fmtPrice(
                  (item.facevalue * quote.last_price) / 100,
                  2,
                )} ${item.currency}`,
              ],
              ["НКД", quote.accruedInt !== null ? `${fmtPrice(quote.accruedInt, 2)} ${item.currency}` : "—"],
              ["Доходность", quote.yield !== null ? `${fmtPrice(quote.yield, 2)} %` : "—"],
              ["Номинал", `${fmtPrice(item.facevalue, 0)} ${item.currency}`],
              ...(maturityDate ? ([["Погашение", maturityDate]] as [string, string][]) : []),
            ]}
          />
        </Section>
      )}

      {item.kind === "futures" && (maturityDate || quote !== undefined) && (
        <Section title="Параметры контракта">
          <StatGrid
            entries={[
              ...(maturityDate ? ([["Экспирация", maturityDate]] as [string, string][]) : []),
              ...(quote !== undefined && quote.open_interest !== null
                ? ([["Открытый интерес", fmtIntOrDash(quote.open_interest)]] as [string, string][])
                : []),
            ]}
          />
        </Section>
      )}

      {item.kind === "futures" && <FuturesUnderlying item={item} refreshToken={refreshToken} />}

      <InstrumentRiskInfo
        symbol={item.symbol}
        decimals={decimals}
        currency={item.currency}
        showMargin={item.kind === "futures"}
      />

      <Collapsible open={showInfo}>
        <InstrumentExtraInfo item={item} />
      </Collapsible>
    </div>
  );
}
