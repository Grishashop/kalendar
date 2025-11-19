"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthButtonClient } from "@/components/auth-button-client";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Calendar } from "@/components/calendar";
import { DayDetailsCard } from "@/components/day-details-card";
import { TradersList } from "@/components/traders-list";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";

interface Trader {
  id: string;
  traders: string;
  date?: string;
  created_at?: string;
}

interface TraderData {
  name_short?: string;
  admin?: boolean;
}

export default function ProtectedPage() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTraders, setSelectedTraders] = useState<Trader[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<any>(null);
  const [traderData, setTraderData] = useState<TraderData | null>(null);
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
        error,
      } = await supabase.auth.getUser();
      if (error || !user) {
        router.push("/auth/login");
      } else {
        setIsAuthenticated(true);
        setUser(user);
        
        // Ищем пользователя в таблице traders по email
        if (user.email) {
          const { data: traderRecord, error: traderError } = await supabase
            .from("traders")
            .select("name_short, admin")
            .eq("mail", user.email)
            .single();
          
          if (!traderError && traderRecord) {
            setTraderData({
              name_short: traderRecord.name_short || undefined,
              admin: traderRecord.admin || false,
            });
          }
        }
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

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full border-b border-b-foreground/10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Левая часть - переключатель темы */}
            <div className="flex items-center">
              <ThemeSwitcher />
            </div>

            {/* Центр - название */}
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <h1 className="text-xl md:text-2xl font-bold">Lavochka2.0</h1>
              <div className="flex flex-col items-center gap-1 mt-1">
                <p className="text-xs md:text-sm text-muted-foreground">
                  {traderData?.name_short 
                    ? `Авторизован как: ${traderData.name_short}` 
                    : user?.email 
                      ? `Авторизован как: ${user.email}` 
                      : "Авторизованный пользователь"}
                </p>
                {traderData?.admin && (
                  <p className="text-xs md:text-sm font-semibold text-red-500">
                    АДМИН
                  </p>
                )}
              </div>
            </div>

            {/* Правая часть - авторизация */}
            <div className="flex items-center">
              <AuthButtonClient />
            </div>
          </div>
        </div>
      </header>

      {/* Основной контент */}
      <div className="flex-1 w-full py-4 md:py-8">
        <Tabs defaultValue="calendar" className="w-full">
          <div className="container mx-auto px-4">
            <TabsList className="mb-6">
              <TabsTrigger value="calendar">Календарь</TabsTrigger>
              <TabsTrigger value="traders">Трейдеры</TabsTrigger>
            </TabsList>
          </div>
          
          <TabsContent value="calendar">
            <Calendar onDayClick={handleDayClick} />
          </TabsContent>
          
          <TabsContent value="traders">
            <TradersList isAdmin={traderData?.admin || false} />
          </TabsContent>
        </Tabs>
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
