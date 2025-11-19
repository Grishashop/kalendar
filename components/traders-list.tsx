"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AddTraderForm } from "@/components/add-trader-form";
import { TraderDetailsCard } from "@/components/trader-details-card";
import { EditTraderForm } from "@/components/edit-trader-form";

interface TraderListItem {
  id: string;
  photo?: string;
  name_short?: string;
  mail?: string;
}

interface TraderDetails {
  id: string;
  name?: string;
  name_short?: string;
  photo?: string;
  mail?: string;
  phone?: string;
  mozno_dezurit?: boolean;
  admin?: boolean;
}

interface TradersListProps {
  isAdmin?: boolean;
}

export function TradersList({ isAdmin = false }: TradersListProps) {
  const [traders, setTraders] = useState<TraderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userExists, setUserExists] = useState<boolean>(false);
  const [userCanDuty, setUserCanDuty] = useState<boolean>(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedTrader, setSelectedTrader] = useState<TraderDetails | null>(null);
  const [editingTrader, setEditingTrader] = useState<TraderDetails | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [lastClickTime, setLastClickTime] = useState<{ id: string; time: number } | null>(null);
  const clickTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    const fetchTraders = async () => {
      setLoading(true);
      setError(null);

      // Проверка переменных окружения
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
        setError("Переменные окружения Supabase не настроены");
        setLoading(false);
        return;
      }

      const supabase = createClient();

      // Получаем email текущего пользователя
      const {
        data: { user },
      } = await supabase.auth.getUser();
      
      if (user?.email) {
        setUserEmail(user.email);
      }

      // Проверяем, есть ли пользователь в таблице traders и может ли он дежурить
      let userTraderData = null;
      let userExistsInTable = false;
      let userCanDutyValue = false;
      
      if (user?.email) {
        const { data: userData } = await supabase
          .from("traders")
          .select("id, photo, name_short, mail, mozno_dezurit")
          .eq("mail", user.email)
          .single();
        
        if (userData) {
          userTraderData = userData;
          userExistsInTable = true;
          userCanDutyValue = userData.mozno_dezurit === true;
          setUserExists(true);
          setUserCanDuty(true);
        } else {
          setUserExists(false);
          setUserCanDuty(false);
        }
      }

      // Если пользователь не найден или не может дежурить - показываем только его данные
      if (!userExistsInTable || !userCanDutyValue) {
        if (userTraderData) {
          setTraders([{
            id: userTraderData.id,
            photo: userTraderData.photo,
            name_short: userTraderData.name_short,
            mail: userTraderData.mail,
          }]);
        } else {
          setTraders([]);
        }
        setLoading(false);
        return;
      }

      // Если пользователь может дежурить - показываем всех трейдеров
      const { data, error: fetchError } = await supabase
        .from("traders")
        .select("id, photo, name_short, mail")
        .order("name_short", { ascending: true });

      console.log("Traders fetch result:", { data, error: fetchError });

      if (fetchError) {
        console.error("Error fetching traders:", fetchError);
        setError(`Ошибка при загрузке трейдеров: ${fetchError.message}`);
        setLoading(false);
        return;
      }

      if (data) {
        console.log("Traders data:", data, "Count:", data.length);
        setTraders(data);
      } else {
        console.log("No data returned from query");
        setTraders([]);
      }

      setLoading(false);
    };

    fetchTraders();
  }, []);

  const handleAddSuccess = async () => {
    setShowAddForm(false);
    setUserExists(true);
    
    // После добавления проверяем mozno_dezurit и обновляем список
    const supabase = createClient();
    
    // Получаем данные пользователя
    const {
      data: { user },
    } = await supabase.auth.getUser();
    
    if (user?.email) {
      const { data: userData } = await supabase
        .from("traders")
        .select("id, photo, name_short, mail, mozno_dezurit")
        .eq("mail", user.email)
        .single();
      
      if (userData) {
        const canDuty = userData.mozno_dezurit === true;
        setUserCanDuty(canDuty);
        
        // Если пользователь не может дежурить - показываем только его данные
        if (!canDuty) {
          setTraders([{
            id: userData.id,
            photo: userData.photo,
            name_short: userData.name_short,
            mail: userData.mail,
          }]);
          return;
        }
      }
    }
    
    // Если пользователь может дежурить - показываем всех
    await refreshTradersList();
  };

  const refreshTradersList = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("traders")
      .select("id, photo, name_short, mail")
      .order("name_short", { ascending: true });
    
    if (data) {
      setTraders(data);
    }
  };

  const handleEditSuccess = () => {
    setEditingTrader(null);
    refreshTradersList();
  };

  const handleDeleteSuccess = () => {
    setEditingTrader(null);
    refreshTradersList();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Загрузка...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-4xl mx-auto p-4 md:p-6">
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6">
          <p className="text-destructive font-semibold mb-2">Ошибка загрузки</p>
          <p className="text-sm text-destructive/80">{error}</p>
          <p className="text-xs text-muted-foreground mt-4">
            Проверьте консоль браузера для подробностей. Возможно, требуется настроить RLS политики в Supabase.
          </p>
        </div>
      </div>
    );
  }

  if (traders.length === 0) {
    return (
      <>
        <div className="w-full max-w-4xl mx-auto p-4 md:p-6">
          <div className="bg-card border rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl md:text-2xl font-semibold">Список трейдеров</h2>
              {!userExists && userEmail && (
                <Button onClick={() => setShowAddForm(true)} size="sm">
                  Добавить себя
                </Button>
              )}
            </div>
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <p className="text-muted-foreground mb-2">Трейдеры не найдены</p>
                <p className="text-xs text-muted-foreground">
                  Проверьте, что в таблице traders есть записи и настроены RLS политики для чтения
                </p>
              </div>
            </div>
          </div>
        </div>

        {showAddForm && userEmail && (
          <AddTraderForm
            userEmail={userEmail}
            onSuccess={handleAddSuccess}
            onCancel={() => setShowAddForm(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="w-full max-w-4xl mx-auto p-4 md:p-6">
        <div className="bg-card border rounded-lg shadow-sm">
          <div className="p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl md:text-2xl font-semibold">Список трейдеров</h2>
              {!userExists && userEmail && (
                <Button onClick={() => setShowAddForm(true)} size="sm">
                  Добавить себя
                </Button>
              )}
            </div>
            <div className="space-y-2">
            {traders.map((trader) => (
              <div
                key={trader.id}
                onClick={async (e) => {
                  const now = Date.now();
                  const isDoubleClick = 
                    lastClickTime?.id === trader.id && 
                    now - lastClickTime.time < 300; // 300ms для двойного клика

                  // Очищаем таймер для этого трейдера, если он существует
                  const existingTimeout = clickTimeoutsRef.current.get(trader.id);
                  if (existingTimeout) {
                    clearTimeout(existingTimeout);
                    clickTimeoutsRef.current.delete(trader.id);
                  }

                  if (isDoubleClick) {
                    // Двойной клик - открываем форму редактирования
                    setLastClickTime(null);
                    setEditError(null);
                    setSelectedTrader(null); // Закрываем карточку просмотра, если открыта
                    
                    // Загружаем полные данные трейдера
                    const supabase = createClient();
                    const { data: fullData, error } = await supabase
                      .from("traders")
                      .select("id, name, name_short, photo, mail, phone, mozno_dezurit, admin")
                      .eq("id", trader.id)
                      .single();
                    
                    if (!error && fullData) {
                      // Проверяем права доступа
                      const canEdit = isAdmin || (userEmail && fullData.mail === userEmail);
                      
                      if (canEdit) {
                        setEditingTrader(fullData);
                      } else {
                        setEditError("Редактировать можно только свою карточку");
                        setTimeout(() => setEditError(null), 3000);
                      }
                    }
                  } else {
                    // Одинарный клик - открываем карточку просмотра
                    setLastClickTime({ id: trader.id, time: now });
                    
                    // Небольшая задержка, чтобы отличить одинарный клик от двойного
                    const timeout = setTimeout(async () => {
                      const supabase = createClient();
                      const { data, error } = await supabase
                        .from("traders")
                        .select("id, name, name_short, photo, mail, phone, mozno_dezurit, admin")
                        .eq("id", trader.id)
                        .single();
                      
                      if (!error && data) {
                        setSelectedTrader(data);
                      }
                      clickTimeoutsRef.current.delete(trader.id);
                    }, 300);
                    
                    clickTimeoutsRef.current.set(trader.id, timeout);
                  }
                }}
                className="flex items-center gap-3 p-3 rounded-lg border bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
              >
                {/* Фото трейдера */}
                <div className="flex-shrink-0 relative">
                  {trader.photo ? (
                    <>
                      <img
                        src={trader.photo}
                        alt={trader.name_short || "Трейдер"}
                        className="w-12 h-12 rounded-full object-cover border-2 border-border"
                        onError={(e) => {
                          // Если изображение не загрузилось, скрываем его
                          e.currentTarget.style.display = "none";
                          const placeholder = e.currentTarget.parentElement?.querySelector(".photo-placeholder");
                          if (placeholder) {
                            placeholder.classList.remove("hidden");
                          }
                        }}
                      />
                      <div className="photo-placeholder hidden w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-sm font-medium border-2 border-border">
                        {trader.name_short
                          ? trader.name_short.charAt(0).toUpperCase()
                          : "?"}
                      </div>
                    </>
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-sm font-medium border-2 border-border">
                      {trader.name_short
                        ? trader.name_short.charAt(0).toUpperCase()
                        : "?"}
                    </div>
                  )}
                </div>
                {/* Имя трейдера */}
                <div className="flex-1">
                  <p className="text-sm md:text-base font-medium">
                    {trader.name_short || "Без имени"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>

      {showAddForm && userEmail && (
        <AddTraderForm
          userEmail={userEmail}
          onSuccess={handleAddSuccess}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {selectedTrader && (
        <TraderDetailsCard
          trader={selectedTrader}
          isAdmin={isAdmin}
          onClose={() => setSelectedTrader(null)}
        />
      )}

      {editingTrader && (
        <EditTraderForm
          trader={editingTrader}
          isAdmin={isAdmin}
          onSuccess={handleEditSuccess}
          onCancel={() => setEditingTrader(null)}
          onDelete={handleDeleteSuccess}
        />
      )}

      {editError && (
        <div className="fixed bottom-4 right-4 z-50 bg-destructive text-destructive-foreground px-4 py-3 rounded-lg shadow-lg">
          <p className="text-sm font-medium">{editError}</p>
        </div>
      )}
    </>
  );
}

