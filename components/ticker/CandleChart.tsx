"use client";

import { useState } from "react";
import type { Candle } from "@/lib/ticker/instruments";
import { fmtPrice } from "@/lib/ticker/instruments";

const CHART_WIDTH = 320;
const CHART_HEIGHT = 88;
const CHART_PADDING_Y = 4;

interface CandleChartProps {
  candles: Candle[] | null;
  decimals: number;
}

export function CandleChart({ candles, decimals }: CandleChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (candles === null) {
    return <div className="h-28 animate-pulse rounded bg-zinc-800" />;
  }
  if (candles.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center text-sm text-zinc-500">
        Нет данных по свечам
      </div>
    );
  }

  const max = Math.max(...candles.map((candle) => candle.high));
  const min = Math.min(...candles.map((candle) => candle.low));
  const range = max - min || 1;
  const usableHeight = CHART_HEIGHT - CHART_PADDING_Y * 2;
  const slotWidth = CHART_WIDTH / candles.length;
  const bodyWidth = Math.max(slotWidth * 0.55, 2);

  function yFor(price: number): number {
    return CHART_PADDING_Y + usableHeight - ((price - min) / range) * usableHeight;
  }

  const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" });
  const fullDateFormat = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hovered = hoveredIndex !== null ? candles[hoveredIndex] : null;

  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-zinc-500">
        {hovered ? (
          <span className="truncate text-zinc-300">
            {fullDateFormat.format(new Date(hovered.time * 1000))} · О {fmtPrice(hovered.open, decimals)} · Макс{" "}
            {fmtPrice(hovered.high, decimals)} · Мин {fmtPrice(hovered.low, decimals)} · Закр{" "}
            {fmtPrice(hovered.close, decimals)}
          </span>
        ) : (
          <span>Дневные свечи, {candles.length}</span>
        )}
        <span className="shrink-0">{fmtPrice(max, decimals)}</span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {candles.map((candle, index) => {
          const x = index * slotWidth + slotWidth / 2;
          const isUp = candle.close >= candle.open;
          const color = isUp ? "#34d399" : "#f87171";
          const bodyTop = yFor(Math.max(candle.open, candle.close));
          const bodyBottom = yFor(Math.min(candle.open, candle.close));
          return (
            <g key={candle.time} onMouseEnter={() => setHoveredIndex(index)}>
              <rect x={index * slotWidth} y={0} width={slotWidth} height={CHART_HEIGHT} fill="transparent" />
              <line x1={x} y1={yFor(candle.high)} x2={x} y2={yFor(candle.low)} stroke={color} strokeWidth={1} />
              <rect
                x={x - bodyWidth / 2}
                y={bodyTop}
                width={bodyWidth}
                height={Math.max(bodyBottom - bodyTop, 1)}
                fill={color}
              />
              {hoveredIndex === index && (
                <line
                  x1={x}
                  y1={CHART_PADDING_Y}
                  x2={x}
                  y2={CHART_HEIGHT - CHART_PADDING_Y}
                  stroke="#71717a"
                  strokeWidth={0.5}
                  strokeDasharray="2,2"
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-zinc-500">
        <span>{dateFormat.format(new Date(candles[0].time * 1000))}</span>
        <span>{dateFormat.format(new Date(candles[candles.length - 1].time * 1000))}</span>
      </div>
    </div>
  );
}
