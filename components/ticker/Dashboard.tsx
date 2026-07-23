"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { WatchItem } from "@/lib/ticker/instruments";
import { watchKey } from "@/lib/ticker/instruments";
import { useWatchlists } from "@/hooks/ticker/useWatchlists";
import { useQuote } from "@/hooks/ticker/useQuote";
import { SearchBox } from "@/components/ticker/SearchBox";
import { WatchlistList } from "@/components/ticker/WatchlistList";
import { InstrumentDetail } from "@/components/ticker/InstrumentDetail";
import { ListTabs } from "@/components/ticker/ListTabs";
import { Collapsible } from "@/components/ticker/Collapsible";

const DEFAULT_COL1_WIDTH = 256;
const DEFAULT_COL2_WIDTH = 288;
const MIN_COL_WIDTH = 180;
const MAX_COL_WIDTH = 480;
const COLUMN_WIDTHS_STORAGE_KEY = "st.columnWidths.v1";

function clampColWidth(value: number): number {
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, value));
}

function loadColumnWidths(): { col1: number; col2: number } {
  try {
    const raw = window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
    if (!raw) return { col1: DEFAULT_COL1_WIDTH, col2: DEFAULT_COL2_WIDTH };
    const parsed = JSON.parse(raw) as { col1?: unknown; col2?: unknown };
    return {
      col1: typeof parsed.col1 === "number" ? clampColWidth(parsed.col1) : DEFAULT_COL1_WIDTH,
      col2: typeof parsed.col2 === "number" ? clampColWidth(parsed.col2) : DEFAULT_COL2_WIDTH,
    };
  } catch {
    return { col1: DEFAULT_COL1_WIDTH, col2: DEFAULT_COL2_WIDTH };
  }
}

/** Разделитель столбцов — тащим мышкой, только на md+ (на мобильном столбцы в один ряд). */
function ResizeHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Изменить ширину столбца"
      className="group relative hidden w-3 shrink-0 cursor-col-resize select-none md:block"
      onMouseDown={(e) => {
        e.preventDefault();
        let lastX = e.clientX;
        function handleMouseMove(moveEvent: MouseEvent) {
          onDrag(moveEvent.clientX - lastX);
          lastX = moveEvent.clientX;
        }
        function handleMouseUp() {
          window.removeEventListener("mousemove", handleMouseMove);
          window.removeEventListener("mouseup", handleMouseUp);
        }
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
      }}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-800 transition-colors group-hover:bg-zinc-500" />
    </div>
  );
}

interface SyncStatus {
  count: number;
  lastSyncedAt: string | null;
}

function formatSyncedAt(value: string | null): string {
  if (!value) return "ещё не выполнялась";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

export function Dashboard() {
  const { lists, activeListId, setActiveListId, addList, renameList, removeList, setListItems } = useWatchlists();
  const [explicitSelectedKey, setExplicitSelectedKey] = useState<string | null>(null);
  const { quotes, loadingKeys, refresh } = useQuote();
  const [refreshToken, setRefreshToken] = useState(0);
  const [colWidths, setColWidths] = useState({ col1: DEFAULT_COL1_WIDTH, col2: DEFAULT_COL2_WIDTH });

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Редко используется, визуально мешал поиску инструментов сразу под
  // строкой ввода — прячем за раскрытием, свёрнуто по умолчанию.
  const [showSyncPanel, setShowSyncPanel] = useState(false);

  useEffect(() => {
    fetch("/api/ticker/instruments/sync")
      .then((res) => (res.ok ? (res.json() as Promise<SyncStatus>) : null))
      .then((data) => data && setSyncStatus(data))
      .catch(() => {});
  }, []);

  const colWidthsHydratedRef = useRef(false);

  useEffect(() => {
    Promise.resolve().then(() => {
      setColWidths(loadColumnWidths());
      colWidthsHydratedRef.current = true;
    });
  }, []);

  useEffect(() => {
    // Пропускаем запись до того, как подгрузили сохранённую ширину из localStorage —
    // иначе этот эффект успевает отработать с дефолтами ДО микротаска гидратации выше
    // и затирает то, что было сохранено при прошлом посещении.
    if (!colWidthsHydratedRef.current) return;
    window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(colWidths));
  }, [colWidths]);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/ticker/instruments/sync", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setSyncError(
          body?.error === "alor_auth_failed"
            ? "Нужен токен Alor (ALOR_TOKEN) для синхронизации"
            : "Ошибка синхронизации",
        );
        return;
      }
      setSyncStatus((await res.json()) as SyncStatus);
    } catch {
      setSyncError("Ошибка синхронизации");
    } finally {
      setSyncing(false);
    }
  }

  const activeList = lists.find((list) => list.id === activeListId) ?? lists[0];
  const items = activeList?.items ?? [];

  // Явный выбор сохраняем, но если инструмент удалён или сменился список — откатываемся на первый доступный.
  const selectedKey =
    explicitSelectedKey !== null && items.some((item) => watchKey(item) === explicitSelectedKey)
      ? explicitSelectedKey
      : (items[0] ? watchKey(items[0]) : null);

  const selectedItem = items.find((item) => watchKey(item) === selectedKey);

  function handleSelect(newItem: WatchItem) {
    if (!activeList) return;
    const key = watchKey(newItem);
    const exists = items.some((item) => watchKey(item) === key);
    if (!exists) {
      setListItems(activeList.id, (prev) => [newItem, ...prev]);
    }
    setExplicitSelectedKey(key);
    refresh(newItem);
  }

  function handleSelectFromList(key: string) {
    setExplicitSelectedKey(key);
    const item = items.find((candidate) => watchKey(candidate) === key);
    if (item) refresh(item);
  }

  function handleRemove(key: string) {
    if (!activeList) return;
    setListItems(activeList.id, (prev) => prev.filter((item) => watchKey(item) !== key));
  }

  function handleReorder(fromIndex: number, toIndex: number) {
    if (!activeList) return;
    setListItems(activeList.id, (prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 md:h-screen md:overflow-hidden">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-zinc-100">Монитор котировок</h1>
        <Link
          href="/market"
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-700"
        >
          ← Обзор рынка
        </Link>
      </div>
      {/* min-h-0 обязателен для flex-1 внутри md:h-screen-предка: flex-basis
          у flex-1 — 0%, и явную height на этом же элементе flexbox просто
          игнорирует (main-axis считается через flex-grow, а не height) —
          высота бралась не от вычисленного flex-grow, а от контента, и
          overflow-y-auto ниже не мог сработать. Решение — не задавать
          height вручную, а ограничить ВЫСОТУ ПРЕДКА (md:h-screen выше) и
          дать flex-1 честно посчитать оставшееся место, min-h-0 разрешает
          сжаться меньше контента вместо того чтобы тянуть родителя дальше
          окна. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 md:flex-row">
        <div
          className="flex w-full flex-col gap-4 md:w-[var(--col1-width)] md:shrink-0"
          style={{ "--col1-width": `${colWidths.col1}px` } as React.CSSProperties}
        >
          <SearchBox onSelect={handleSelect} />
          <button
            type="button"
            onClick={() => setShowSyncPanel((v) => !v)}
            className="self-start text-xs text-zinc-600 hover:text-zinc-400"
          >
            {showSyncPanel ? "Скрыть статус базы ▲" : "Статус базы ▾"}
          </button>
          <Collapsible open={showSyncPanel}>
            <div className="flex flex-col gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500">
                  {syncStatus ? `Инструментов в базе: ${syncStatus.count}` : "База не загружена"}
                </span>
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing}
                  className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {syncing ? "Обновляем…" : "Актуализировать"}
                </button>
              </div>
              <span className="text-zinc-600">Обновлено: {formatSyncedAt(syncStatus?.lastSyncedAt ?? null)}</span>
              {syncError && <span className="text-red-400">{syncError}</span>}
            </div>
          </Collapsible>
        </div>

        <ResizeHandle
          onDrag={(delta) =>
            setColWidths((w) => ({ ...w, col1: clampColWidth(w.col1 + delta) }))
          }
        />
        <aside
          className="flex w-full min-h-0 flex-col gap-3 md:h-full md:w-[var(--col2-width)] md:shrink-0"
          style={{ "--col2-width": `${colWidths.col2}px` } as React.CSSProperties}
        >
          <ListTabs
            lists={lists}
            activeListId={activeListId}
            onSelect={setActiveListId}
            onAdd={addList}
            onRename={renameList}
            onRemove={removeList}
          />
          {/* min-h-0 обязателен: без него flex-элемент не сжимается меньше
              содержимого, и overflow-y-auto никогда не включится — список
              просто растянет родителя дальше границы окна. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <WatchlistList
              items={items}
              selectedKey={selectedKey}
              onSelect={handleSelectFromList}
              onRemove={handleRemove}
              onReorder={handleReorder}
            />
          </div>
        </aside>

        <ResizeHandle
          onDrag={(delta) =>
            setColWidths((w) => ({ ...w, col2: clampColWidth(w.col2 + delta) }))
          }
        />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto md:h-full">
          {selectedItem ? (
            <InstrumentDetail
              key={selectedKey}
              item={selectedItem}
              quote={quotes.get(selectedKey ?? "")}
              loading={loadingKeys.has(selectedKey ?? "")}
              onRemove={() => handleRemove(selectedKey ?? "")}
              onRefresh={() => {
                refresh(selectedItem);
                setRefreshToken((token) => token + 1);
              }}
              refreshToken={refreshToken}
            />
          ) : (
            <div className="mx-auto flex h-full min-h-64 max-w-md flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-800 text-center text-zinc-500">
              <svg className="h-10 w-10 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 15l4-5 3 3 5-7" />
                <circle cx="19" cy="6" r="1.5" fill="currentColor" stroke="none" />
              </svg>
              <span>Выберите инструмент из списка слева</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
