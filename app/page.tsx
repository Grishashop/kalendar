"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { AuthButtonClient } from "@/components/auth-button-client";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Calendar } from "@/components/calendar";
import { DayDetailsCard } from "@/components/day-details-card";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface Trader {
  id: string;
  traders: string;
  date?: string;
  created_at?: string;
}

export default function Home() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTraders, setSelectedTraders] = useState<Trader[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      // Проверка переменных окружения
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
        setIsAuthenticated(false);
        return;
      }
      
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setIsAuthenticated(true);
        router.push("/protected");
      } else {
        setIsAuthenticated(false);
      }
    };
    checkAuth();
  }, [router]);

  const handleDayClick = (date: Date, traders: Trader[]) => {
    setSelectedDate(date);
    setSelectedTraders(traders);
  };

  const handleCloseCard = () => {
    setSelectedDate(null);
    setSelectedTraders([]);
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Загрузка...</div>
      </div>
    );
  }

  // Проверка переменных окружения
  const hasEnvVars =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!hasEnvVars) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4">
        <div className="max-w-2xl w-full space-y-4">
          <div className="flex justify-center">
            <Image
              src="/logo.png"
              alt="Lavochka 2.0"
              width={200}
              height={67}
              className="h-12 w-auto object-contain"
              priority
            />
          </div>
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold text-destructive">
              Требуются переменные окружения Supabase
            </h2>
            <p className="text-sm text-muted-foreground">
              Для работы приложения необходимо настроить переменные окружения Supabase.
            </p>
            <div className="space-y-2 text-sm">
              <p className="font-medium">Создайте файл <code className="bg-muted px-2 py-1 rounded">.env.local</code> в корне проекта со следующим содержимым:</p>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto">
{`NEXT_PUBLIC_SUPABASE_URL=your-project-url-here
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-anon-key-here`}
              </pre>
              <p className="text-muted-foreground">
                Получите эти значения в настройках вашего Supabase проекта:{" "}
                <a
                  href="https://supabase.com/dashboard/project/_/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  https://supabase.com/dashboard/project/_/settings/api
                </a>
              </p>
              <p className="text-muted-foreground mt-4">
                После добавления переменных окружения перезапустите сервер разработки.
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full border-b border-b-foreground/10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Левая часть - логотип */}
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

            {/* Центр - описание */}
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <p className="text-xs md:text-sm text-muted-foreground">
                Пользователь не авторизован (только просмотровый режим)
              </p>
            </div>

            {/* Правая часть - переключатель темы и авторизация */}
            <div className="flex items-center gap-3">
              <ThemeSwitcher />
              <AuthButtonClient />
            </div>
          </div>
        </div>
      </header>

      {/* Основной контент */}
      <div className="flex-1 w-full py-4 md:py-8">
        <Calendar onDayClick={handleDayClick} />
      </div>

      {/* Карточка с деталями дня */}
      {selectedDate && (
        <DayDetailsCard
          date={selectedDate}
          traders={selectedTraders}
          onClose={handleCloseCard}
        />
      )}
    </main>
  );
}
