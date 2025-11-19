"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

interface Trader {
  id: string;
  traders: string;
  date?: string;
  created_at?: string;
}

interface CalendarProps {
  onDayClick: (date: Date, traders: Trader[]) => void;
}

const monthNames = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function Calendar({ onDayClick }: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [traders, setTraders] = useState<Map<string, Trader[]>>(new Map());
  const [loading, setLoading] = useState(true);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  useEffect(() => {
    const fetchTraders = async () => {
      setLoading(true);
      
      // Проверка переменных окружения
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
        console.error("Supabase environment variables are not set");
        setLoading(false);
        return;
      }
      
      const supabase = createClient();

      // Получаем первый и последний день месяца
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);

      // Получаем все данные из таблицы traders
      // Фильтрацию по дате делаем на клиенте, так как структура таблицы может отличаться
      const { data, error } = await supabase.from("traders").select("*");

      if (error) {
        console.error("Error fetching traders:", error);
        setLoading(false);
        return;
      }

      // Группируем по датам и фильтруем по текущему месяцу
      const tradersMap = new Map<string, Trader[]>();
      if (data) {
        data.forEach((trader) => {
          // Используем date если есть, иначе created_at
          const dateKey = trader.date || trader.created_at?.split("T")[0] || "";
          if (dateKey) {
            // Фильтруем по месяцу на клиенте
            const traderDate = new Date(dateKey);
            if (
              traderDate >= firstDay &&
              traderDate <= lastDay &&
              traderDate.getMonth() === month &&
              traderDate.getFullYear() === year
            ) {
              const existing = tradersMap.get(dateKey) || [];
              tradersMap.set(dateKey, [...existing, trader]);
            }
          }
        });
      }

      setTraders(tradersMap);
      setLoading(false);
    };

    fetchTraders();
  }, [year, month]);

  const getDaysInMonth = () => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = (firstDay.getDay() + 6) % 7; // Понедельник = 0

    const days: (Date | null)[] = [];

    // Пустые ячейки до первого дня месяца
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    // Дни месяца
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    return days;
  };

  const previousMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleDayClick = (date: Date | null) => {
    if (!date) return;

    const dateKey = date.toISOString().split("T")[0];
    const dayTraders = traders.get(dateKey) || [];
    onDayClick(date, dayTraders);
  };

  const days = getDaysInMonth();
  const today = new Date();
  const isToday = (date: Date | null) => {
    if (!date) return false;
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-4">
      <div className="bg-card border rounded-lg shadow-sm p-4 md:p-6">
        {/* Header с навигацией */}
        <div className="flex items-center justify-between mb-6">
          <Button
            variant="outline"
            size="icon"
            onClick={previousMonth}
            className="h-8 w-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-xl md:text-2xl font-semibold">
            {monthNames[month]} {year}
          </h2>
          <Button
            variant="outline"
            size="icon"
            onClick={nextMonth}
            className="h-8 w-8"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Дни недели */}
        <div className="grid grid-cols-7 gap-1 md:gap-2 mb-2">
          {weekDays.map((day) => (
            <div
              key={day}
              className="text-center text-sm font-medium text-muted-foreground py-2"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Календарная сетка */}
        {!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ? (
          <div className="text-center py-8 text-muted-foreground">
            Переменные окружения Supabase не настроены
          </div>
        ) : loading ? (
          <div className="text-center py-8 text-muted-foreground">
            Загрузка...
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1 md:gap-2">
            {days.map((date, index) => {
              if (!date) {
                return <div key={index} className="aspect-square" />;
              }

              const dateKey = date.toISOString().split("T")[0];
              const dayTraders = traders.get(dateKey) || [];
              const todayClass = isToday(date)
                ? "bg-primary text-primary-foreground font-semibold"
                : "bg-muted hover:bg-muted/80";

              return (
                <button
                  key={index}
                  onClick={() => handleDayClick(date)}
                  className={cn(
                    "aspect-square rounded-md p-1 md:p-2 text-left transition-colors",
                    "flex flex-col items-start justify-start",
                    "text-xs md:text-sm",
                    todayClass
                  )}
                >
                  <span className="mb-1">{date.getDate()}</span>
                  <div className="flex flex-col gap-0.5 w-full overflow-hidden">
                    {dayTraders.slice(0, 2).map((trader, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          "text-[10px] md:text-xs truncate px-1 py-0.5 rounded",
                          isToday(date)
                            ? "bg-primary-foreground/20"
                            : "bg-background/50"
                        )}
                        title={trader.traders}
                      >
                        {trader.traders}
                      </div>
                    ))}
                    {dayTraders.length > 2 && (
                      <div className="text-[10px] text-muted-foreground">
                        +{dayTraders.length - 2}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

