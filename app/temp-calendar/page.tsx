"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Plus, Unlock, X } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { getMoscowDate, getMoscowDateComponents, formatDateMoscow, createMoscowDate } from "@/lib/date-utils";

type CalendarData = Record<string, string[]>;

const monthNames = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const ADMIN_STORAGE_KEY = "temp-calendar-admin-password";

// Порядок отображения и цвет по типу дежурства. Тип извлекается из строки
// вида "Имя — Тип" / "Имя — Тип (не утв.)", которую формирует import-скрипт
// и форма редактирования (см. saveEditor).
const DUTY_TYPE_ORDER: Record<string, number> = {
  "Утро": 0,
  "Вечер": 1,
  "Отгул": 2,
  "ДСВД": 3,
};

const DUTY_TYPE_COLORS: Record<string, string> = {
  "Утро": "#93C5FD", // светло-синий
  "Вечер": "#8B5A2B", // коричневый
  "Отгул": "#EF4444", // красный
  "ДСВД": "#FACC15", // жёлтый
};

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

function sortByDutyType(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const orderA = DUTY_TYPE_ORDER[extractDutyType(a) ?? ""] ?? 99;
    const orderB = DUTY_TYPE_ORDER[extractDutyType(b) ?? ""] ?? 99;
    return orderA - orderB;
  });
}

// Типы дежурства, предлагаемые в форме редактирования. "Отпуск" встречается
// в перенесённых из Supabase данных, поэтому оставлен в списке, но не имеет
// отдельного цвета (см. DUTY_TYPE_COLORS).
const DUTY_TYPES = ["Утро", "Вечер", "Отгул", "ДСВД", "Отпуск"];

type DutyEntry = { name: string; type: string; approved: boolean };

function parseEntry(label: string): DutyEntry {
  const approved = !/\(не утв\.\)\s*$/.test(label);
  const withoutSuffix = label.replace(/\s*\(не утв\.\)\s*$/, "");
  const idx = withoutSuffix.lastIndexOf("—");
  if (idx === -1) {
    return { name: withoutSuffix.trim(), type: DUTY_TYPES[0], approved };
  }
  return {
    name: withoutSuffix.slice(0, idx).trim(),
    type: withoutSuffix.slice(idx + 1).trim() || DUTY_TYPES[0],
    approved,
  };
}

function formatEntry(entry: DutyEntry): string {
  const base = `${entry.name} — ${entry.type}`;
  return entry.approved ? base : `${base} (не утв.)`;
}

export default function TempCalendarPage() {
  const today = getMoscowDateComponents(getMoscowDate());
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month - 1); // 0-11
  const [data, setData] = useState<CalendarData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adminPassword, setAdminPassword] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editingEntries, setEditingEntries] = useState<DutyEntry[]>([]);
  const [saving, setSaving] = useState(false);

  const knownNames = useMemo(() => {
    const set = new Set<string>();
    Object.values(data).forEach((list) => {
      list.forEach((label) => {
        const name = parseEntry(label).name;
        if (name) set.add(name);
      });
    });
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [data]);

  useEffect(() => {
    const saved = window.localStorage.getItem(ADMIN_STORAGE_KEY);
    if (saved) setAdminPassword(saved);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/temp-calendar", { cache: "no-store" });
      if (!res.ok) throw new Error("Не удалось загрузить расписание");
      const json = (await res.json()) as CalendarData;
      setData(json);
      setError(null);
    } catch {
      setError("Не удалось загрузить расписание. Попробуйте обновить страницу.");
    } finally {
      setLoading(false);
    }
  }, []);

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
    window.localStorage.setItem(ADMIN_STORAGE_KEY, passwordInput.trim());
    setAdminPassword(passwordInput.trim());
    setPasswordInput("");
    setShowPasswordForm(false);
  };

  const handleLock = () => {
    window.localStorage.removeItem(ADMIN_STORAGE_KEY);
    setAdminPassword(null);
    setEditingDate(null);
  };

  const openEditor = (dateKey: string) => {
    if (!isAdmin) return;
    setEditingDate(dateKey);
    setEditingEntries((data[dateKey] || []).map(parseEntry));
  };

  const addEntryRow = () => {
    setEditingEntries((prev) => [...prev, { name: "", type: DUTY_TYPES[0], approved: true }]);
  };

  const removeEntryRow = (idx: number) => {
    setEditingEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateEntryRow = (idx: number, patch: Partial<DutyEntry>) => {
    setEditingEntries((prev) => prev.map((entry, i) => (i === idx ? { ...entry, ...patch } : entry)));
  };

  const saveEditor = async () => {
    if (!editingDate || !adminPassword) return;
    setSaving(true);
    const names = editingEntries
      .filter((entry) => entry.name.trim())
      .map((entry) => formatEntry({ ...entry, name: entry.name.trim() }));
    try {
      const res = await fetch("/api/temp-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword, date: editingDate, names }),
      });
      if (res.status === 401) {
        setError("Неверный пароль администратора. Попробуйте войти заново.");
        handleLock();
        return;
      }
      if (!res.ok) throw new Error("Ошибка сохранения");
      const json = await res.json();
      setData(json.data as CalendarData);
      setEditingDate(null);
      setError(null);
    } catch {
      setError("Не удалось сохранить изменения. Попробуйте ещё раз.");
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
    const firstOfMonth = createMoscowDate(year, month + 1, 1);
    const firstWeekday = (firstOfMonth.getUTCDay() + 6) % 7; // 0 = Пн
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: Array<{ dateKey: string; day: number } | null> = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ dateKey: formatDateMoscow(createMoscowDate(year, month + 1, d)), day: d });
    }
    return cells;
  }, [year, month]);

  const todayKey = formatDateMoscow(getMoscowDate());

  return (
    <main className="min-h-screen flex flex-col">
      <header className="w-full border-b border-b-foreground/10 bg-background/95 backdrop-blur sticky top-0 z-40">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Image src="/logo.png" alt="Lavochka 2.0" width={120} height={40} className="h-8 w-auto object-contain" priority />
            </div>
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <p className="text-xs md:text-sm text-muted-foreground">
                Временный календарь дежурств (Supabase временно недоступен)
              </p>
            </div>
            <div className="flex items-center gap-2">
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
              <Button size="sm" onClick={handleUnlock}>Ок</Button>
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
                    <span className={cn("text-xs", isToday ? "font-bold text-primary" : "text-muted-foreground")}>
                      {cell.day}
                    </span>
                    <div className="flex flex-col gap-0.5 overflow-hidden">
                      {sortByDutyType(names).map((name, idx) => {
                        const type = extractDutyType(name);
                        const color = type ? DUTY_TYPE_COLORS[type] : undefined;
                        return (
                          <span
                            key={idx}
                            className={cn(
                              "text-[11px] leading-tight rounded px-1 py-0.5 truncate",
                              !color && "bg-secondary text-secondary-foreground",
                            )}
                            style={color ? { backgroundColor: color, color: getContrastColor(color) } : undefined}
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

          <p className="mt-6 text-xs text-muted-foreground text-center">
            Это временная страница на отдельном хранилище (Vercel Blob), не связанная с основной базой данных.
            После восстановления лимитов Supabase дежурства нужно будет перенести в основной календарь вручную.
          </p>
        </div>
      </div>

      {editingDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingDate(null)}>
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
                    list="temp-calendar-known-names"
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
                    {DUTY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
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
              <datalist id="temp-calendar-known-names">
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
    </main>
  );
}
