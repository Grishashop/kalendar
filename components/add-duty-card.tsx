"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateMoscow } from "@/lib/date-utils";

interface Trader {
  id: string;
  name_short?: string;
  mail?: string;
}

interface DutyType {
  tip_dezursva_or_otdyh: string;
  ves?: number;
  color?: string;
}

interface AddDutyCardProps {
  date: Date;
  userEmail: string | null;
  isAdmin: boolean;
  currentTraderName?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function AddDutyCard({
  date,
  userEmail,
  isAdmin,
  onSuccess,
  onCancel,
}: AddDutyCardProps) {
  const [selectedTraderId, setSelectedTraderId] = useState<string>("");
  const [selectedTraderName, setSelectedTraderName] = useState<string>("");
  const [selectedDutyType, setSelectedDutyType] = useState<string>("");
  const [utverzdeno, setUtverzdeno] = useState(false);
  const [traders, setTraders] = useState<Trader[]>([]);
  const [dutyTypes, setDutyTypes] = useState<DutyType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoadingData(true);
      const supabase = createClient();

      // Загружаем трейдеров
      if (isAdmin) {
        // Для админа - все трейдеры с mozno_dezurit = true
        const { data: tradersData, error: tradersError } = await supabase
          .from("traders")
          .select("id, name_short, mail")
          .eq("mozno_dezurit", true)
          .order("name_short", { ascending: true });

        if (!tradersError && tradersData) {
          setTraders(tradersData);
        }
      } else {
        // Для обычного пользователя - только его запись (текущее имя трейдера)
        if (userEmail) {
          const { data: traderData, error: traderError } = await supabase
            .from("traders")
            .select("id, name_short, mail")
            .eq("mail", userEmail)
            .single();

          if (!traderError && traderData) {
            setTraders([traderData]);
            setSelectedTraderId(traderData.id);
            setSelectedTraderName(traderData.name_short || "");
          }
        }
      }

      // Загружаем типы дежурств
      const { data: dutyTypesData, error: dutyTypesError } = await supabase
        .from("typ_dezurstva")
        .select("tip_dezursva_or_otdyh, ves, color")
        .order("ves", { ascending: true });

      if (!dutyTypesError && dutyTypesData) {
        // Фильтруем и сортируем по ves (чем меньше значение, тем выше)
        const filteredTypes = dutyTypesData
          .filter((item) => item.tip_dezursva_or_otdyh !== null && item.tip_dezursva_or_otdyh !== undefined)
          .sort((a, b) => {
            const vesA = a.ves ?? 999999;
            const vesB = b.ves ?? 999999;
            return vesA - vesB;
          });
        setDutyTypes(filteredTypes);
      }

      setIsLoadingData(false);
    };

    fetchData();
  }, [isAdmin, userEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Проверка всех полей
    if (!selectedTraderId || !selectedTraderName) {
      setError("Пожалуйста, выберите трейдера");
      setIsLoading(false);
      return;
    }

    if (!selectedDutyType) {
      setError("Пожалуйста, выберите тип дежурства");
      setIsLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      // Форматируем дату в московском времени, чтобы избежать сдвига на день
      const dateStr = formatDateMoscow(date);

      const insertData: {
        date_dezurztva_or_otdyh: string;
        traders: string;
        tip_dezursva_or_otdyh: string;
        utverzdeno?: boolean;
      } = {
        date_dezurztva_or_otdyh: dateStr,
        traders: selectedTraderName, // Сохраняем name_short, а не ID
        tip_dezursva_or_otdyh: selectedDutyType,
      };

      // Только админ может устанавливать utverzdeno
      if (isAdmin) {
        insertData.utverzdeno = utverzdeno;
      }

      console.log("Inserting data:", insertData);

      const { data, error: insertError } = await supabase
        .from("dezurstva")
        .insert(insertData)
        .select();

      console.log("Insert result:", { data, error: insertError });

      if (insertError) {
        console.error("Insert error details:", insertError);
        throw insertError;
      }

      onSuccess();
    } catch (err: unknown) {
      console.error("Error in handleSubmit:", err);
      let errorMessage = "Произошла ошибка при добавлении";
      
      if (err && typeof err === 'object' && 'message' in err) {
        errorMessage = String(err.message);
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      weekday: "long",
    });
  };

  if (isLoadingData) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-6">
            <p className="text-center text-muted-foreground">Загрузка данных...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Checkbox id="date" checked={true} disabled />
            <Label htmlFor="date" className="text-base font-semibold">
              {formatDate(date)}
            </Label>
          </div>
          <CardDescription>Добавить дежурство</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Первая колонка - Трейдеры */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Трейдер</Label>
                <div className="border rounded-md p-3 max-h-64 overflow-y-auto space-y-2">
                  {traders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Трейдеры не найдены</p>
                  ) : (
                    traders.map((trader) => (
                      <div
                        key={trader.id}
                        className={cn(
                          "p-2 rounded-md cursor-pointer transition-colors",
                          selectedTraderId === trader.id
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted hover:bg-muted/80"
                        )}
                        onClick={() => {
                          setSelectedTraderId(trader.id);
                          setSelectedTraderName(trader.name_short || "");
                        }}
                      >
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            checked={selectedTraderId === trader.id}
                            onCheckedChange={() => {
                              setSelectedTraderId(trader.id);
                              setSelectedTraderName(trader.name_short || "");
                            }}
                          />
                          <span className="text-sm font-medium">
                            {trader.name_short || "Без имени"}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Вторая колонка - Типы дежурств */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Тип дежурства</Label>
                <div className="border rounded-md p-3 max-h-64 overflow-y-auto space-y-2">
                  {dutyTypes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Типы дежурств не найдены</p>
                  ) : (
                    dutyTypes.map((type) => {
                      // Используем tip_dezursva_or_otdyh как уникальный ключ
                      const typeKey = type.tip_dezursva_or_otdyh;
                      const isSelected = selectedDutyType === typeKey;
                      const bgColor = type.color || "#f3f4f6";
                      
                      // Определяем цвет текста в зависимости от яркости фона
                      const getTextColor = (bgColor: string) => {
                        if (!bgColor || bgColor === "#f3f4f6") return undefined;
                        try {
                          // Простая проверка яркости цвета
                          const hex = bgColor.replace('#', '');
                          if (hex.length !== 6) return "#000000";
                          const r = parseInt(hex.substr(0, 2), 16);
                          const g = parseInt(hex.substr(2, 2), 16);
                          const b = parseInt(hex.substr(4, 2), 16);
                          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                          return brightness > 128 ? "#000000" : "#ffffff";
                        } catch {
                          return "#000000";
                        }
                      };
                      
                      const textColor = getTextColor(bgColor);
                      
                      return (
                        <div
                          key={typeKey}
                          className="p-2 rounded-md cursor-pointer transition-all"
                          style={{
                            backgroundColor: bgColor,
                            color: textColor,
                            boxShadow: isSelected ? '0 0 0 2px hsl(var(--primary))' : 'none',
                          }}
                          onClick={() => {
                            setSelectedDutyType(typeKey);
                          }}
                        >
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => {
                                setSelectedDutyType(typeKey);
                              }}
                            />
                            <span 
                              className="text-sm font-medium"
                              style={{
                                color: textColor,
                              }}
                            >
                              {typeKey}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Чекбокс "Утверждено" */}
            <div className="flex items-center space-x-2 pt-4 border-t">
              <Checkbox
                id="utverzdeno"
                checked={utverzdeno}
                onCheckedChange={(checked) => setUtverzdeno(checked === true)}
                disabled={!isAdmin}
                className={cn(!isAdmin && "opacity-50 cursor-not-allowed")}
              />
              <Label
                htmlFor="utverzdeno"
                className={cn(
                  "text-sm font-medium leading-none",
                  !isAdmin && "text-muted-foreground"
                )}
              >
                Утверждено
                {!isAdmin && (
                  <span className="text-xs text-muted-foreground ml-2">
                    (только для администратора)
                  </span>
                )}
              </Label>
            </div>

            {error && (
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button type="submit" className="flex-1" disabled={isLoading}>
                {isLoading ? "Добавление..." : "Добавить в БД"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={onCancel}
                disabled={isLoading}
              >
                Отмена
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

