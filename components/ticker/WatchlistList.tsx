"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { WatchItem } from "@/lib/ticker/instruments";
import { watchKey } from "@/lib/ticker/instruments";
import { InstrumentIcon } from "@/components/ticker/InstrumentIcon";

const REMOVE_DURATION_MS = 180;
const FLIP_DURATION_MS = 200;

interface WatchlistListProps {
  items: WatchItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onRemove: (key: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function WatchlistList({ items, selectedKey, onSelect, onRemove, onReorder }: WatchlistListProps) {
  // Нативный HTML5 drag-and-drop — без сторонней библиотеки. dragIndex — какую
  // позицию тащим; overIndex — над какой позицией сейчас курсор (для верхней
  // полоски-индикатора места вставки).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // Элемент уже "уходит" (свернулся визуально), но ещё не удалён из данных —
  // ждём конца анимации перед фактическим onRemove, иначе список дёргается.
  const [removingKeys, setRemovingKeys] = useState<Set<string>>(new Set());

  // FLIP для реордера: без этого при drag-n-drop соседние элементы мгновенно
  // телепортируются на новые позиции — глаз не читает это как "я передвинул
  // ЭТОТ элемент". Каждый рендер после смены порядка ловим дельту позиции
  // каждого узла и проигрываем анимацию transform от старой позиции к новой.
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const prevRectsRef = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    const newRects = new Map<string, DOMRect>();
    rowRefs.current.forEach((el, key) => {
      newRects.set(key, el.getBoundingClientRect());
    });
    prevRectsRef.current.forEach((prevRect, key) => {
      const newRect = newRects.get(key);
      const el = rowRefs.current.get(key);
      if (!newRect || !el) return;
      const deltaY = prevRect.top - newRect.top;
      if (deltaY === 0) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${deltaY}px)`;
      requestAnimationFrame(() => {
        el.style.transition = `transform ${FLIP_DURATION_MS}ms ease-out`;
        el.style.transform = "";
      });
    });
    prevRectsRef.current = newRects;
  });

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
        Найдите инструмент по тикеру, ISIN или названию
      </div>
    );
  }

  function handleDrop(toIndex: number) {
    if (dragIndex !== null && dragIndex !== toIndex) onReorder(dragIndex, toIndex);
    setDragIndex(null);
    setOverIndex(null);
  }

  function handleRemove(key: string) {
    setRemovingKeys((prev) => new Set(prev).add(key));
    setTimeout(() => {
      onRemove(key);
      setRemovingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, REMOVE_DURATION_MS);
  }

  return (
    <div className="flex flex-col gap-1">
      {items.map((item, index) => {
        const key = watchKey(item);
        const selected = key === selectedKey;
        const removing = removingKeys.has(key);

        return (
          <div
            key={key}
            ref={(el) => {
              if (el) rowRefs.current.set(key, el);
              else rowRefs.current.delete(key);
            }}
            className={`grid transition-[grid-template-rows,opacity] ease-out ${
              removing ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
            }`}
            style={{ transitionDuration: `${REMOVE_DURATION_MS}ms` }}
          >
            <div
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(e) => {
                setDragIndex(index);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overIndex !== index) setOverIndex(index);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(index);
              }}
              onClick={() => onSelect(key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect(key);
              }}
              className={`group flex cursor-grab items-center gap-3 overflow-hidden rounded-md border-t-2 px-2 py-2 text-left transition-colors active:cursor-grabbing ${
                overIndex === index && dragIndex !== null && dragIndex !== index
                  ? "border-t-emerald-500"
                  : "border-t-transparent"
              } ${dragIndex === index ? "opacity-40" : ""} ${selected ? "bg-zinc-800" : "hover:bg-zinc-900"}`}
            >
              <InstrumentIcon kind={item.kind} symbol={item.symbol} shortname={item.shortname} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-100">{item.shortname}</div>
                <div
                  className="truncate text-xs text-zinc-500"
                  title={
                    item.kind === "futures" && item.underlyingName
                      ? `Базовый актив: ${item.underlyingName}`
                      : undefined
                  }
                >
                  {item.symbol}
                  {item.kind !== "futures" && ` · ${item.exchange}`}
                  {item.kind === "futures" && item.underlyingName && ` · база: ${item.underlyingName}`}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(key);
                }}
                aria-label="Удалить из списка"
                className="shrink-0 rounded px-1.5 py-1 text-zinc-600 opacity-0 hover:bg-zinc-700 hover:text-zinc-300 group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
