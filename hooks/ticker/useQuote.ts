"use client";

import { useCallback, useState } from "react";
import type { Quote, WatchItem } from "@/lib/ticker/instruments";
import { watchKey } from "@/lib/ticker/instruments";

/**
 * Котировки обновляются только по требованию — при добавлении инструмента, клике по нему
 * в списке избранного и по кнопке «Обновить» в карточке (никаких WS/поллинга в фоне).
 */
export function useQuote() {
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());

  const refresh = useCallback(async (item: WatchItem): Promise<boolean> => {
    const key = watchKey(item);
    setLoadingKeys((prev) => new Set(prev).add(key));
    try {
      const res = await fetch(`/api/ticker/quotes?symbols=${encodeURIComponent(key)}`);
      if (!res.ok) return false;
      const data = (await res.json()) as Quote[];
      const quote = Array.isArray(data) ? data[0] : undefined;
      if (!quote) return false;
      setQuotes((prev) => new Map(prev).set(key, quote));
      return true;
    } catch {
      return false;
    } finally {
      setLoadingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  return { quotes, loadingKeys, refresh };
}
