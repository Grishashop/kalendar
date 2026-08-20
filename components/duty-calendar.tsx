"use client";

// Календарь дежурств на отдельном хранилище (Vercel Blob), с правкой по паролю.
// Один компонент на два отдела: трейдеры (/temp-calendar) и поддержка клиентов
// (/support-calendar). Копия вместо параметров означала бы, что правка в одном
// календаре молча не доезжает до другого.
//
// Данные каждого отдела лежат в своём файле и правятся своим паролем — отделы
// не видят друг друга и не могут править чужое расписание.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Palette, Plus, Unlock, X } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  getMoscowDate,
  getMoscowDateComponents,
  formatDateMoscow,
  createMoscowDate,
} from "@/lib/date-utils";

export interface DutyType {
  name: string;
  /** Без цвета смена рисуется нейтрально — так «Отпуск» выглядел с самого начала. */
  color?: string;
}

/** Дни: «ГГГГ-ММ-ДД» → строки вида «Имя — Тип» / «Имя — Тип (не утв.)». */
export type CalendarData = Record<string, string[]>;

interface DutyCalendarProps {
  apiPath: string;
  /** Ключ хранилища пароля: у каждого отдела свой, иначе вход в один даст другой. */
  storageKey: string;
  subtitle: string;
  footer: string;
  /**
   * Фиксированный набор типов дежурства. Задан — редактор типов недоступен.
   * Не задан — типы приходят из API и правятся администратором: у другого отдела
   * свои смены, и угадывать их за него неправильно.
   */
  fixedTypes?: readonly DutyType[];
}

const monthNames = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Палитра для новых типов: по кругу, чтобы соседние отличались на глаз. */
const PALETTE = [
  "#93C5FD", "#FACC15", "#86EFAC", "#FDA4AF", "#C4B5FD",
  "#FDBA74", "#67E8F9", "#8B5A2B", "#EF4444", "#A3A3A3",
];

function getContrastColor(hexColor: string): string {
  const color = hexColor.replace("#", "");
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? "#000000" : "#ffffff";
}

function extractDutyType(label: string): string | null {
  const idx = label.lastIndexOf("—");
  if (idx === -1) return null;
  return label.slice(idx + 1).replace(/\(не утв\.\)/, "").trim();
}

type DutyEntry = { name: string; type: string; approved: boolean };

function parseEntry(label: string, fallbackType: string): DutyEntry {
  const approved = !/\(не утв\.\)\s*$/.test(label);
  const withoutSuffix = label.replace(/\s*\(не утв\.\)\s*$/, "");
  const idx = withoutSuffix.lastIndexOf("—");
  if (idx === -1) {
    return { name: withoutSuffix.trim(), type: fallbackType, approved };
  }
  return {
    name: withoutSuffix.slice(0, idx).trim(),
    type: withoutSuffix.slice(idx + 1).trim() || fallbackType,
    approved,
  };
}

function formatEntry(entry: DutyEntry): string {
  const base = `${entry.name} — ${entry.type}`;
  return entry.approved ? base : `${base} (не утв.)`;
}

/** Ответ API: либо просто дни (старый формат), либо дни с типами. */
function normalize(json: unknown): { days: CalendarData; types: DutyType[] | null } {
  if (json && typeof json === "object" && "days" in json) {
    const payload = json as { days?: CalendarData; types?: DutyType[] };
    return { days: payload.days ?? {}, types: payload.types ?? null };
  }
  return { days: (json ?? {}) as CalendarData, types: null };
}

export function DutyCalendar({
  apiPath,
  storageKey,
  subtitle,
  footer,
  fixedTypes,
}: DutyCalendarProps) {
  const today = getMoscowDateComponents(getMoscowDate());
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month - 1); // 0-11
  const [data, setData] = useState<CalendarData>({});
  const [loadedTypes, setLoadedTypes] = useState<DutyType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adminPassword, setAdminPassword] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editingEntries, setEditingEntries] = useState<DutyEntry[]>([]);
  const [saving, setSaving] = useState(false);

  const [typesOpen, setTypesOpen] = useState(false);
  const [draftTypes, setDraftTypes] = useState<DutyType[]>([]);

  const types: readonly DutyType[] = fixedTypes ?? loadedTypes;
  const typeByName = useMemo(
    () => new Map(types.map((item) => [item.name, item])),
    [types],
  );
  // Порядок в календаре — порядок в списке типов: смены идут по расписанию дня,
  // а не по алфавиту. Неизвестный тип уходит в конец, а не теряется.
  const typeOrder = useMemo(
    () => new Map(types.map((item, index) => [item.name, index])),
    [types],
  );
  const fallbackType = types[0]?.name ?? "";

  const sortByDutyType = useCallback(
    (names: string[]) =>
      [...names].sort(
        (a, b) =>
          (typeOrder.get(extractDutyType(a) ?? "") ?? 99) -
          (typeOrder.get(extractDutyType(b) ?? "") ?? 99),
      ),
    [typeOrder],
  );

  const knownNames = useMemo(() => {
    const set = new Set<string>();
    Object.values(data).forEach((list) => {
      list.forEach((label) => {
        const name = parseEntry(label, fallbackType).name;
        if (name) set.add(name);
      });
    });
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [data, fallbackType]);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) setAdminPassword(saved);
  }, [storageKey]);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(apiPath, { cache: "no-store" });
      if (!res.ok) throw new Error("Не удалось загрузить расписание");
      const { days, types: loaded } = normalize(await res.json());
      setData(days);
      if (loaded) setLoadedTypes(loaded);
      setError(null);
    } catch {
      setError("Не удалось загрузить расписание. Попробуйте обновить страницу.");
    } finally {
      setLoading(false);
    }
  }, [apiPath]);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      if (document.hidden) return;
      loadData();
    }, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const isAdmin = adminPassword !== null;

  const handleUnlock = () => {
    if (!passwordInput.trim()) return;
    window.localStorage.setItem(storageKey, passwordInput.trim());
    setAdminPassword(passwordInput.trim());
    setPasswordInput("");
    setShowPasswordForm(false);
  };

  const handleLock = () => {
    window.localStorage.removeItem(storageKey);
    setAdminPassword(null);
    setEditingDate(null);
    setTypesOpen(false);
  };

  const openEditor = (dateKey: string) => {
    if (!isAdmin) return;
    setEditingDate(dateKey);
    setEditingEntries((data[dateKey] || []).map((label) => parseEntry(label, fallbackType)));
  };

  const addEntryRow = () => {
    setEditingEntries((prev) => [...prev, { name: "", type: fallbackType, approved: true }]);
  };

  const removeEntryRow = (idx: number) => {
    setEditingEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateEntryRow = (idx: number, patch: Partial<DutyEntry>) => {
    setEditingEntries((prev) => prev.map((entry, i) => (i === idx ? { ...entry, ...patch } : entry)));
  };

  /** Ответ 401 означает, что пароль сменили: держать его в браузере незачем. */
  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPassword, ...body }),
    });
    if (res.status === 401) {
      setError("Неверный пароль администратора. Попробуйте войти заново.");
      handleLock();
      return null;
    }
    if (res.status === 503) {
      setError(
        "Правка недоступна: администратору сайта нужно задать пароль этого календаря в переменных окружения.",
      );
      return null;
    }
    if (!res.ok) throw new Error("Ошибка сохранения");
    return (await res.json()) as { days?: CalendarData; types?: DutyType[] };
  };

  const saveEditor = async () => {
    if (!editingDate || !adminPassword) return;
    setSaving(true);
    const names = editingEntries
      .filter((entry) => entry.name.trim())
      .map((entry) => formatEntry({ ...entry, name: entry.name.trim() }));
    try {
      const json = await post({ date: editingDate, names });
      if (!json) return;
      const { days, types: loaded } = normalize(json);
      setData(days);
      if (loaded) setLoadedTypes(loaded);
      setEditingDate(null);
      setError(null);
    } catch {
      setError("Не удалось сохранить изменения. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  };

  const saveTypes = async () => {
    if (!adminPassword) return;
    const cleaned = draftTypes
      .map((item) => ({ name: item.name.trim(), color: item.color }))
      .filter((item) => item.name !== "");
    if (cleaned.length === 0) {
      setError("Оставьте хотя бы один тип дежурства.");
      return;
    }
    setSaving(true);
    try {
      const json = await post({ types: cleaned });
      if (!json) return;
      const { days, types: loaded } = normalize(json);
      setData(days);
      if (loaded) setLoadedTypes(loaded);
      setTypesOpen(false);
      setError(null);
    } catch {
      setError("Не удалось сохранить типы дежурств. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  };

  const goToPrevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const days = useMemo(() => {
    // День недели календарной даты не зависит от часового пояса, поэтому считаем
    // его напрямую по году/месяцу/дню, а не через createMoscowDate — тот сдвигает
    // UTC-момент на предыдущий день (баг: 1 июля 2026 показывался вторником).
    const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // 0 = Пн
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: Array<{ dateKey: string; day: number } | null> = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ dateKey: formatDateMoscow(createMoscowDate(year, month + 1, d)), day: d });
    }
    return cells;
  }, [year, month]);

  const todayKey = formatDateMoscow(getMoscowDate());
  const namesListId = `${storageKey}-known-names`;

  return (
    <main className="min-h-screen flex flex-col">
      <header className="w-full border-b border-b-foreground/10 bg-background/95 backdrop-blur sticky top-0 z-40">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Image
                src="/logo.png"
                alt="Lavochka 2.0"
                width={120}
                height={40}
                className="h-8 w-auto object-contain"
                priority
              />
            </div>
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <p className="text-xs md:text-sm text-muted-foreground">{subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && !fixedTypes && (
                <Button variant="outline" size="sm" onClick={() => {
                  setDraftTypes(types.map((item) => ({ ...item })));
                  setTypesOpen(true);
                }}>
                  <Palette className="size-4" />
                  Смены
                </Button>
              )}
              {isAdmin ? (
                <Button variant="outline" size="sm" onClick={handleLock}>
                  <Unlock className="size-4" />
                  Админ
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setShowPasswordForm((v) => !v)}>
                  <Lock className="size-4" />
                  Войти
                </Button>
              )}
            </div>
          </div>

          {showPasswordForm && !isAdmin && (
            <div className="flex items-center gap-2 justify-end pb-2">
              <Input
                type="password"
                placeholder="Пароль администратора"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
                className="max-w-[220px] h-8"
              />
              <Button size="sm" onClick={handleUnlock}>
                Ок
              </Button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 w-full py-4 md:py-8">
        <div className="container mx-auto px-4 max-w-3xl">
          {error && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            <Button variant="outline" size="icon" onClick={goToPrevMonth}>
              <ChevronLeft className="size-4" />
            </Button>
            <h1 className="text-lg font-semibold">
              {monthNames[month]} {year}
            </h1>
            <Button variant="outline" size="icon" onClick={goToNextMonth}>
              <ChevronRight className="size-4" />
            </Button>
          </div>

          {loading ? (
            <div className="text-center text-muted-foreground py-12">Загрузка...</div>
          ) : (
            <div className="grid grid-cols-7 gap-1.5">
              {weekDays.map((wd) => (
                <div key={wd} className="text-center text-xs text-muted-foreground font-medium py-1">
                  {wd}
                </div>
              ))}
              {days.map((cell, i) => {
                if (!cell) return <div key={`empty-${i}`} />;
                const names = data[cell.dateKey] || [];
                const isToday = cell.dateKey === todayKey;
                return (
                  <button
                    key={cell.dateKey}
                    onClick={() => openEditor(cell.dateKey)}
                    disabled={!isAdmin}
                    className={cn(
                      "min-h-[76px] rounded-lg border p-1.5 text-left flex flex-col gap-0.5 transition-colors",
                      isToday ? "border-primary" : "border-border",
                      isAdmin ? "hover:bg-accent cursor-pointer" : "cursor-default",
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs",
                        isToday ? "font-bold text-primary" : "text-muted-foreground",
                      )}
                    >
                      {cell.day}
                    </span>
                    <div className="flex flex-col gap-0.5 overflow-hidden">
                      {sortByDutyType(names).map((name, idx) => {
                        const type = extractDutyType(name);
                        const color = type ? typeByName.get(type)?.color : undefined;
                        return (
                          <span
                            key={idx}
                            className={cn(
                              "text-[11px] leading-tight rounded px-1 py-0.5 truncate",
                              !color && "bg-secondary text-secondary-foreground",
                            )}
                            style={
                              color
                                ? { backgroundColor: color, color: getContrastColor(color) }
                                : undefined
                            }
                          >
                            {name}
                          </span>
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {types.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {types.map((item) => (
                <span
                  key={item.name}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[11px]",
                    !item.color && "bg-secondary text-secondary-foreground",
                  )}
                  style={
                    item.color
                      ? { backgroundColor: item.color, color: getContrastColor(item.color) }
                      : undefined
                  }
                >
                  {item.name}
                </span>
              ))}
            </div>
          )}

          <p className="mt-6 text-xs text-muted-foreground text-center">{footer}</p>
        </div>
      </div>

      {editingDate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setEditingDate(null)}
        >
          <div
            className="bg-card text-card-foreground rounded-xl border shadow-lg w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Дежурные — {editingDate}</h2>
              <Button variant="ghost" size="icon" onClick={() => setEditingDate(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {editingEntries.length === 0 && (
                <p className="text-xs text-muted-foreground">Дежурных пока нет — добавьте ниже.</p>
              )}
              {editingEntries.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <Input
                    list={namesListId}
                    value={entry.name}
                    onChange={(e) => updateEntryRow(idx, { name: e.target.value })}
                    placeholder="Имя дежурного"
                    className="h-8 flex-1 min-w-0"
                  />
                  <select
                    value={entry.type}
                    onChange={(e) => updateEntryRow(idx, { type: e.target.value })}
                    className="h-8 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {/* Тип из старых данных мог быть удалён из списка смен — держим
                        его в выпадающем, иначе правка строки молча сменила бы смену. */}
                    {[...new Set([...types.map((t) => t.name), entry.type].filter(Boolean))].map(
                      (t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ),
                    )}
                  </select>
                  <Checkbox
                    checked={entry.approved}
                    onCheckedChange={(v) => updateEntryRow(idx, { approved: v === true })}
                    title="Утверждено"
                    className="shrink-0"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => removeEntryRow(idx)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <datalist id={namesListId}>
                {knownNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <Button variant="outline" size="sm" onClick={addEntryRow} className="w-full">
                <Plus className="size-4" />
                Добавить дежурного
              </Button>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="outline" onClick={() => setEditingDate(null)} disabled={saving}>
                Отмена
              </Button>
              <Button onClick={saveEditor} disabled={saving}>
                {saving ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {typesOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setTypesOpen(false)}
        >
          <div
            className="bg-card text-card-foreground rounded-xl border shadow-lg w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold">Смены отдела</h2>
              <Button variant="ghost" size="icon" onClick={() => setTypesOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Порядок здесь задаёт порядок внутри дня в календаре. Переименование смены не меняет
              уже расставленные дежурства — старое название останется в них до правки дня.
            </p>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {draftTypes.map((item, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <Input
                    value={item.name}
                    onChange={(e) =>
                      setDraftTypes((prev) =>
                        prev.map((t, i) => (i === idx ? { ...t, name: e.target.value } : t)),
                      )
                    }
                    placeholder="Название смены"
                    className="h-8 flex-1 min-w-0"
                  />
                  <input
                    type="color"
                    value={item.color ?? PALETTE[idx % PALETTE.length]}
                    onChange={(e) =>
                      setDraftTypes((prev) =>
                        prev.map((t, i) => (i === idx ? { ...t, color: e.target.value } : t)),
                      )
                    }
                    className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent"
                    aria-label={`Цвет смены «${item.name}»`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setDraftTypes((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() =>
                  setDraftTypes((prev) => [
                    ...prev,
                    { name: "", color: PALETTE[prev.length % PALETTE.length] },
                  ])
                }
              >
                <Plus className="size-4" />
                Добавить смену
              </Button>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="outline" onClick={() => setTypesOpen(false)} disabled={saving}>
                Отмена
              </Button>
              <Button onClick={saveTypes} disabled={saving}>
                {saving ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
