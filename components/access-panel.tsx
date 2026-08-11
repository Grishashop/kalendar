"use client";

// Раздел админки «Доступ к разделам»: у каждого раздела режим, у режима
// «по списку» — галочки по трейдерам.
// Решение — docs/adr/0011-dostup-k-razdelam-v-middleware.md
//
// Решение принимается про раздел, а не про человека («кого пустить в Карман»,
// а не «куда пустить Иванова»), поэтому экран построен по разделам, а список
// не размазан по карточкам трейдеров.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_MODES,
  MODE_LABELS,
  PAGES,
  PAGE_LABELS,
  modesFor,
  type AccessMode,
  type Page,
} from "@/lib/access";

interface TraderRow {
  id: number;
  name_short: string | null;
  mail: string | null;
}

/** Пояснение к режиму — чтобы выбор не сводился к угадыванию по названию. */
const MODE_HINTS: Record<AccessMode, string> = {
  public: "Открыт всем, включая тех, кто не вошёл.",
  authenticated: "Любому вошедшему. Карточка трейдера не требуется.",
  list: "Только отмеченным ниже трейдерам.",
};

export function AccessPanel() {
  const [modes, setModes] = useState<Record<Page, AccessMode>>(DEFAULT_MODES);
  const [allowed, setAllowed] = useState<Record<Page, Set<number>>>({
    market: new Set(),
    karman: new Set(),
    ticker: new Set(),
  });
  const [traders, setTraders] = useState<TraderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    setError(null);
    const [modeRows, listRows, traderRows] = await Promise.all([
      supabase.from("page_access").select("page, mode"),
      supabase.from("page_access_trader").select("page, trader_id"),
      supabase.from("traders").select("id, name_short, mail").order("name_short"),
    ]);

    if (modeRows.error) {
      // Таблиц нет — миграция не применена. Говорим прямо, куда смотреть:
      // молчаливый экран с режимами по умолчанию выглядел бы как рабочий.
      setError(
        "Таблицы доступа не найдены. Выполните supabase/page_access.sql в SQL Editor проекта Supabase.",
      );
      setLoading(false);
      return;
    }

    const nextModes = { ...DEFAULT_MODES };
    for (const row of (modeRows.data ?? []) as { page: string; mode: string }[]) {
      if ((PAGES as readonly string[]).includes(row.page)) {
        nextModes[row.page as Page] = row.mode as AccessMode;
      }
    }

    const nextAllowed: Record<Page, Set<number>> = {
      market: new Set(),
      karman: new Set(),
      ticker: new Set(),
    };
    for (const row of (listRows.data ?? []) as { page: string; trader_id: number }[]) {
      if ((PAGES as readonly string[]).includes(row.page)) {
        nextAllowed[row.page as Page].add(row.trader_id);
      }
    }

    setModes(nextModes);
    setAllowed(nextAllowed);
    setTraders((traderRows.data ?? []) as TraderRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Отказ RLS в `UPDATE` и `DELETE` не приходит ошибкой: политика отфильтровывает
   * строки, изменяется ноль строк, и PostgREST отвечает успехом. Поэтому просим
   * вернуть изменённые строки и трактуем пустой ответ как отказ — иначе экран
   * говорил бы «сохранено», не сохранив ничего. Проверено анонимным PATCH:
   * http=204 при неизменённых данных.
   */
  const NOT_ADMIN = "изменение отклонено. Права администратора не подтверждены.";

  const changeMode = async (page: Page, mode: AccessMode) => {
    setSaving(`mode:${page}`);
    const supabase = createClient();
    const { data, error: updateError } = await supabase
      .from("page_access")
      .update({ mode })
      .eq("page", page)
      .select("page");
    setSaving(null);
    if (updateError || !data || data.length === 0) {
      setError(
        `Режим «${PAGE_LABELS[page]}» не изменён: ${updateError?.message ?? NOT_ADMIN}`,
      );
      await load();
      return;
    }
    setError(null);
    setModes((current) => ({ ...current, [page]: mode }));
  };

  const toggleTrader = async (page: Page, traderId: number, on: boolean) => {
    setSaving(`trader:${page}:${traderId}`);
    const supabase = createClient();
    const { data, error: writeError } = on
      ? await supabase
          .from("page_access_trader")
          .insert({ page, trader_id: traderId })
          .select("page")
      : await supabase
          .from("page_access_trader")
          .delete()
          .eq("page", page)
          .eq("trader_id", traderId)
          .select("page");
    setSaving(null);
    if (writeError || !data || data.length === 0) {
      setError(
        `Список «${PAGE_LABELS[page]}» не изменён: ${writeError?.message ?? NOT_ADMIN}`,
      );
      await load();
      return;
    }
    setError(null);
    setAllowed((current) => {
      const next = new Set(current[page]);
      if (on) next.add(traderId);
      else next.delete(traderId);
      return { ...current, [page]: next };
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Загрузка доступа…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        Режим определяет, кому открыт раздел — страница вместе с её серверными
        маршрутами. Изменения действуют в течение пяти секунд.
      </p>

      {PAGES.map((page) => {
        const mode = modes[page];
        const list = allowed[page];
        return (
          <div key={page} className="rounded-lg border p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-base font-medium">{PAGE_LABELS[page]}</h3>
              <select
                aria-label={`Режим доступа: ${PAGE_LABELS[page]}`}
                value={mode}
                disabled={saving === `mode:${page}`}
                onChange={(e) => changeMode(page, e.target.value as AccessMode)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {modesFor(page).map((option) => (
                  <option key={option} value={option}>
                    {MODE_LABELS[option]}
                  </option>
                ))}
              </select>
              {saving === `mode:${page}` && <Spinner className="h-4 w-4" />}
            </div>

            <p className="text-xs text-muted-foreground">{MODE_HINTS[mode]}</p>

            {/* «Публично» есть только у «Маркета»: за остальными разделами стоит
                приватный токен, и публичный режим отдал бы его анониму. */}
            {!modesFor(page).includes("public") && (
              <p className="text-xs text-muted-foreground">
                Публичный режим недоступен: за разделом стоит приватный токен.
              </p>
            )}

            {mode === "list" && (
              <div className="space-y-2 pt-1">
                {traders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    В справочнике нет трейдеров — отмечать некого.
                  </p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {traders.map((trader) => {
                      const busy = saving === `trader:${page}:${trader.id}`;
                      return (
                        <li key={trader.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`${page}-${trader.id}`}
                            checked={list.has(trader.id)}
                            disabled={busy}
                            onCheckedChange={(checked) =>
                              toggleTrader(page, trader.id, checked === true)
                            }
                          />
                          <label
                            htmlFor={`${page}-${trader.id}`}
                            className="text-sm leading-none"
                          >
                            {trader.name_short || trader.mail || `#${trader.id}`}
                          </label>
                          {busy && <Spinner className="h-3 w-3" />}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  Отмечено: {list.size} из {traders.length}
                </p>
              </div>
            )}
          </div>
        );
      })}

      <Button variant="outline" size="sm" onClick={load}>
        Обновить
      </Button>
    </div>
  );
}
