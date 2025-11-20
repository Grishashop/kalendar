"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthButtonClient } from "@/components/auth-button-client";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Calendar } from "@/components/calendar";
import { DayDetailsCard } from "@/components/day-details-card";
import { AddDutyCard } from "@/components/add-duty-card";
import { TradersList } from "@/components/traders-list";
import { AdminPanel } from "@/components/admin-panel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface Duty {
  id: string;
  traders: string;
  date_dezurztva_or_otdyh?: string;
  tip_dezursva_or_otdyh?: string;
  utverzdeno?: boolean;
  created_at?: string;
}

interface TraderData {
  name_short?: string;
  admin?: boolean;
  zametki?: boolean;
  chat?: boolean;
}

export default function ProtectedPage() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedDuties, setSelectedDuties] = useState<Duty[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<any>(null);
  const [traderData, setTraderData] = useState<TraderData | null>(null);
  const [showAddDutyCard, setShowAddDutyCard] = useState(false);
  const [addDutyDate, setAddDutyDate] = useState<Date | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
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
            .select("name_short, admin, zametki, chat")
            .eq("mail", user.email)
            .single();
          
          if (!traderError && traderRecord) {
            setTraderData({
              name_short: traderRecord.name_short || undefined,
              admin: traderRecord.admin || false,
              zametki: traderRecord.zametki || false,
              chat: traderRecord.chat || false,
            });
          }
        }
      }
    };
    checkAuth();
  }, [router]);

  const handleDayClick = (date: Date, duties: Duty[]) => {
    setSelectedDate(date);
    setSelectedDuties(duties);
  };

  const handleCloseCard = () => {
    setSelectedDate(null);
    setSelectedDuties([]);
  };

  const handleDoubleClick = (date: Date) => {
    setAddDutyDate(date);
    setShowAddDutyCard(true);
    setSelectedDate(null); // Закрываем карточку просмотра, если открыта
  };

  const handleAddDutySuccess = () => {
    setShowAddDutyCard(false);
    setAddDutyDate(null);
    // Обновляем страницу для перезагрузки календаря
    window.location.reload();
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
                  <p
                    className="text-xs md:text-sm font-semibold text-red-500 cursor-pointer hover:text-red-600 transition-colors"
                    onClick={() => setShowAdminPanel(true)}
                  >
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
            <TabsList className={cn(
              "mb-6 grid w-full",
              traderData?.zametki === true && traderData?.chat === true ? "grid-cols-4" :
              traderData?.zametki === true || traderData?.chat === true ? "grid-cols-3" :
              "grid-cols-2"
            )}>
              <TabsTrigger value="calendar">Календарь</TabsTrigger>
              <TabsTrigger value="traders">Трейдеры</TabsTrigger>
              {traderData?.zametki === true && (
                <TabsTrigger value="notes">Заметки</TabsTrigger>
              )}
              {traderData?.chat === true && (
                <TabsTrigger value="chat">Чат</TabsTrigger>
              )}
            </TabsList>
          </div>
          
          <TabsContent value="calendar">
            <Calendar 
              onDayClick={handleDayClick} 
              onDoubleClick={handleDoubleClick}
            />
          </TabsContent>
          
          <TabsContent value="traders">
            <TradersList isAdmin={traderData?.admin || false} />
          </TabsContent>

          {traderData?.zametki === true && (
            <TabsContent value="notes">
              <div className="w-full max-w-4xl mx-auto p-4">
                <div className="bg-card border rounded-lg shadow-sm p-4 md:p-6">
                  <h2 className="text-xl md:text-2xl font-semibold mb-4">Заметки</h2>
                  <p className="text-muted-foreground">
                    Здесь будут ваши заметки...
                  </p>
                </div>
              </div>
            </TabsContent>
          )}

          {traderData?.chat === true && (
            <TabsContent value="chat">
              <div className="w-full max-w-4xl mx-auto p-4">
                <div className="bg-card border rounded-lg shadow-sm p-4 md:p-6">
                  <h2 className="text-xl md:text-2xl font-semibold mb-4">Чат</h2>
                  <p className="text-muted-foreground">
                    Здесь будет чат...
                  </p>
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Карточка с деталями дня */}
      {selectedDate && (
        <DayDetailsCard
          date={selectedDate}
          traders={selectedDuties}
          onClose={handleCloseCard}
          userEmail={user?.email || null}
          isAdmin={traderData?.admin || false}
          currentTraderName={traderData?.name_short}
          onDelete={() => {
            // Обновляем страницу для перезагрузки календаря
            window.location.reload();
          }}
        />
      )}

      {/* Карточка добавления дежурства */}
      {showAddDutyCard && addDutyDate && (
        <AddDutyCard
          date={addDutyDate}
          userEmail={user?.email || null}
          isAdmin={traderData?.admin || false}
          currentTraderName={traderData?.name_short}
          onSuccess={handleAddDutySuccess}
          onCancel={() => {
            setShowAddDutyCard(false);
            setAddDutyDate(null);
          }}
        />
      )}

      {/* Панель администратора */}
      {showAdminPanel && traderData?.admin && (
        <AdminPanel onClose={() => setShowAdminPanel(false)} />
      )}
    </main>
  );
}
