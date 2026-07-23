"use client";

import { useSyncExternalStore } from "react";
import type { WatchItem, WatchlistCollection } from "@/lib/ticker/instruments";
import { loadWatchlists, saveWatchlists } from "@/lib/ticker/instruments";

type ItemsUpdater = WatchItem[] | ((prev: WatchItem[]) => WatchItem[]);

interface Snapshot {
  lists: WatchlistCollection[];
  activeId: string;
}

const EMPTY_SNAPSHOT: Snapshot = { lists: [], activeId: "" };

let snapshot: Snapshot = EMPTY_SNAPSHOT;
let hydrated = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  saveWatchlists(snapshot.lists, snapshot.activeId);
  notify();
}

function ensureHydrated(): void {
  if (hydrated || typeof window === "undefined") return;
  snapshot = loadWatchlists();
  hydrated = true;
}

function getSnapshot(): Snapshot {
  ensureHydrated();
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return EMPTY_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setActiveListId(id: string): void {
  ensureHydrated();
  if (id === snapshot.activeId || !snapshot.lists.some((list) => list.id === id)) return;
  snapshot = { ...snapshot, activeId: id };
  persist();
}

function addList(name: string): void {
  ensureHydrated();
  const trimmed = name.trim();
  if (!trimmed) return;
  const newList: WatchlistCollection = { id: crypto.randomUUID(), name: trimmed, items: [] };
  snapshot = { lists: [...snapshot.lists, newList], activeId: newList.id };
  persist();
}

function renameList(id: string, name: string): void {
  ensureHydrated();
  const trimmed = name.trim();
  if (!trimmed) return;
  snapshot = {
    ...snapshot,
    lists: snapshot.lists.map((list) => (list.id === id ? { ...list, name: trimmed } : list)),
  };
  persist();
}

/** Список нельзя удалить, если он последний — тогда просто очищаем его содержимое. */
function removeList(id: string): void {
  ensureHydrated();
  if (snapshot.lists.length <= 1) {
    snapshot = { ...snapshot, lists: snapshot.lists.map((list) => (list.id === id ? { ...list, items: [] } : list)) };
    persist();
    return;
  }
  const remaining = snapshot.lists.filter((list) => list.id !== id);
  const activeId = id === snapshot.activeId ? remaining[0].id : snapshot.activeId;
  snapshot = { lists: remaining, activeId };
  persist();
}

function setListItems(id: string, updater: ItemsUpdater): void {
  ensureHydrated();
  const target = snapshot.lists.find((list) => list.id === id);
  if (!target) return;
  const nextItems = typeof updater === "function" ? updater(target.items) : updater;
  snapshot = {
    ...snapshot,
    lists: snapshot.lists.map((list) => (list.id === id ? { ...list, items: nextItems } : list)),
  };
  persist();
}

/** Несколько именованных списков избранного (localStorage), синхронизировано через useSyncExternalStore. */
export function useWatchlists() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    lists: state.lists,
    activeListId: state.activeId,
    setActiveListId,
    addList,
    renameList,
    removeList,
    setListItems,
  };
}
