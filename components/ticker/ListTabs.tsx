"use client";

import { useState } from "react";
import type { WatchlistCollection } from "@/lib/ticker/instruments";

interface ListTabsProps {
  lists: WatchlistCollection[];
  activeListId: string;
  onSelect: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

/** Русское склонение: 1 инструмент, 2–4 инструмента, 5+ инструментов (и 11–14 — тоже "инструментов"). */
function pluralizeInstruments(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "инструмент";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "инструмента";
  return "инструментов";
}

const REMOVE_DURATION_MS = 180;

export function ListTabs({ lists, activeListId, onSelect, onAdd, onRename, onRemove }: ListTabsProps) {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // Список уже "схлопывается" визуально, но ещё не удалён из данных — ждём
  // конца анимации перед фактическим onRemove.
  const [removingId, setRemovingId] = useState<string | null>(null);

  function submitCreate() {
    const name = draftName.trim();
    if (name) onAdd(name);
    setDraftName("");
    setCreating(false);
  }

  function submitRename(id: string) {
    const name = editDraft.trim();
    if (name) onRename(id, name);
    setEditingId(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {lists.map((list) => {
        const isActive = list.id === activeListId;
        const isEditing = editingId === list.id;

        if (isEditing) {
          return (
            <input
              key={list.id}
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onBlur={() => submitRename(list.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename(list.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              className="w-28 rounded-full border border-zinc-600 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-100 outline-none"
            />
          );
        }

        return (
          <div
            key={list.id}
            style={{ transitionDuration: `${REMOVE_DURATION_MS}ms` }}
            className={`grid transition-[grid-template-columns,opacity] ease-out ${
              removingId === list.id ? "grid-cols-[0fr] opacity-0" : "grid-cols-[1fr] opacity-100"
            }`}
          >
            <div
              className={`group flex items-center gap-1 overflow-hidden rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                isActive ? "bg-zinc-100 text-zinc-900" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(list.id)}
                onDoubleClick={() => {
                  setEditingId(list.id);
                  setEditDraft(list.name);
                }}
                className="max-w-32 truncate"
                title="Двойной клик — переименовать"
              >
                {list.name}
              </button>
              {lists.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const count = list.items.length;
                    const countLabel = count > 0 ? ` (${count} ${pluralizeInstruments(count)})` : "";
                    if (
                      window.confirm(`Удалить список «${list.name}»${countLabel}? Это действие нельзя отменить.`)
                    ) {
                      setRemovingId(list.id);
                      setTimeout(() => {
                        onRemove(list.id);
                        setRemovingId(null);
                      }, REMOVE_DURATION_MS);
                    }
                  }}
                  aria-label={`Удалить список «${list.name}»`}
                  className={`shrink-0 opacity-0 group-hover:opacity-100 ${
                    isActive ? "text-zinc-500 hover:text-zinc-800" : "text-zinc-600 hover:text-zinc-300"
                  }`}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}

      {creating ? (
        <input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={submitCreate}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitCreate();
            if (e.key === "Escape") {
              setDraftName("");
              setCreating(false);
            }
          }}
          placeholder="Название списка"
          className="w-28 rounded-full border border-zinc-600 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-100 outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          aria-label="Новый список"
          className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-400 hover:bg-zinc-800"
        >
          + Список
        </button>
      )}
    </div>
  );
}
