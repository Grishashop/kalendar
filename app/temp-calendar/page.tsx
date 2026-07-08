"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Unlock, X } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getMoscowDate, getMoscowDateComponents, formatDateMoscow, createMoscowDate } from "@/lib/date-utils";

type CalendarData = Record<string, string[]>;

const monthNames = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const ADMIN_STORAGE_KEY = "temp-calendar-admin-password";

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
  const [editingNames, setEditingNames] = useState("");
  const [saving, setSaving] = useState(false);

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
    setEditingNames((data[dateKey] || []).join(", "));
  };

  const saveEditor = async () => {
    if (!editingDate || !adminPassword) return;
    setSaving(true);
    const names = editingNames.split(",").map((n) => n.trim()).filter(Boolean);
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
                      {names.map((name, idx) => (
                        <span
                          key={idx}
                          className="text-[11px] leading-tight bg-secondary text-secondary-foreground rounded px-1 py-0.5 truncate"
                        >
                          {name}
                        </span>
                      ))}
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
            <Textarea
              value={editingNames}
              onChange={(e) => setEditingNames(e.target.value)}
              placeholder="Имена через запятую, например: Иванов, Петров"
              rows={3}
            />
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
