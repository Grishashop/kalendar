"use client";

import { useState } from "react";
import type { InstrumentKind, WatchItem } from "@/lib/ticker/instruments";
import { kindLabel } from "@/lib/ticker/instruments";

type KindFilter = "all" | InstrumentKind;

const FILTER_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "stock", label: "Акции" },
  { value: "bond", label: "Облигации" },
  { value: "futures", label: "Фьючерсы" },
];

interface SearchBoxProps {
  onSelect: (item: WatchItem) => void;
}

export function SearchBox({ onSelect }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WatchItem[]>([]);
  const [fuzzy, setFuzzy] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<KindFilter>("all");

  async function runSearch() {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setFuzzy(false);
      setStatus("idle");
      setOpen(false);
      return;
    }

    setStatus("loading");
    setOpen(true);
    try {
      const res = await fetch(`/api/ticker/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        setStatus("error");
        setResults([]);
        setFuzzy(false);
        return;
      }
      const data = (await res.json()) as { results?: WatchItem[]; fuzzy?: boolean };
      setResults(Array.isArray(data.results) ? data.results : []);
      setFuzzy(Boolean(data.fuzzy));
      setStatus("idle");
    } catch {
      setStatus("error");
      setResults([]);
      setFuzzy(false);
    }
  }

  function handleSelect(item: WatchItem) {
    onSelect(item);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  const trimmedQuery = query.trim();
  const showDropdown = open && trimmedQuery.length >= 2;
  const filteredResults = filter === "all" ? results : results.filter((item) => item.kind === filter);

  return (
    <div className="relative w-full">
      <div className="flex flex-wrap gap-1.5">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFilter(option.value)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === option.value
                ? "bg-zinc-100 text-zinc-900"
                : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            const value = e.target.value;
            setQuery(value);
            if (value.trim().length < 2) {
              setResults([]);
              setFuzzy(false);
              setStatus("idle");
              setOpen(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch();
            }
            if (e.key === "Escape") setOpen(false);
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Тикер, ISIN или название — Enter для поиска"
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={runSearch}
          aria-label="Искать"
          className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-400 hover:bg-zinc-800"
        >
          ⌕
        </button>
      </div>
      {showDropdown && (
        <div className="absolute z-10 mt-1 max-h-96 w-full animate-fade-slide-in overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-xl">
          {status === "loading" && (
            <div className="px-4 py-3 text-sm text-zinc-500">Поиск...</div>
          )}
          {status === "error" && (
            <div className="px-4 py-3 text-sm text-red-400">Ошибка поиска, повторите</div>
          )}
          {status === "idle" && filteredResults.length === 0 && (
            <div className="px-4 py-3 text-sm text-zinc-500">
              Ничего не найдено. Если инструмент новый, нажмите «Актуализировать» в базе.
            </div>
          )}
          {status === "idle" && filteredResults.length > 0 && fuzzy && (
            <div className="border-b border-zinc-800 px-4 py-2 text-xs text-amber-400">
              Точных совпадений нет. Возможно, вы искали:
            </div>
          )}
          {status === "idle" &&
            filteredResults.map((item) => (
              <button
                key={`${item.exchange}:${item.symbol}:${item.board}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(item)}
                className="flex w-full flex-col gap-0.5 border-b border-zinc-800 px-4 py-2.5 text-left last:border-b-0 hover:bg-zinc-800"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-zinc-100">{item.shortname}</span>
                  <span className="shrink-0 text-sm text-zinc-400">{item.symbol}</span>
                  <span className="ml-auto shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                    {kindLabel(item.kind)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>
                    {item.exchange} · {item.board}
                  </span>
                  {item.isin && <span>{item.isin}</span>}
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
