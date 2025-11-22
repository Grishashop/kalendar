"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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

interface DayDetailsCardProps {
  date: Date;
  traders: Duty[];
  onClose: () => void;
  userEmail?: string | null;
  isAdmin?: boolean;
  currentTraderName?: string;
  onDelete?: () => void;
}

const formatDate = (date: Date) => {
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
  });
};

export function DayDetailsCard({
  date,
  traders,
  onClose,
  isAdmin = false,
  currentTraderName,
  onDelete,
}: DayDetailsCardProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duties, setDuties] = useState<Duty[]>(traders);

  useEffect(() => {
    setDuties(traders);
  }, [traders]);

  const handleDelete = async (duty: Duty) => {
    // Проверка 1: Если не админ - может удалить только свою запись
    if (!isAdmin) {
      if (duty.traders !== currentTraderName) {
        setError("Вы можете удалить только свою запись");
        setTimeout(() => setError(null), 3000);
        return;
      }
    }

    // Проверка 2: Если utverzdeno === true и пользователь не админ - нельзя удалять
    if (!isAdmin && duty.utverzdeno === true) {
      setError("Нельзя удалить утвержденную запись");
      setTimeout(() => setError(null), 3000);
      return;
    }

    // Проверка 3: Подтверждение удаления
    if (!confirm("Вы уверены в удалении?")) {
      return;
    }

    setDeletingId(duty.id);
    setError(null);

    try {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("dezurstva")
        .delete()
        .eq("id", duty.id);

      if (deleteError) {
        throw deleteError;
      }

      // Обновляем список после удаления
      if (onDelete) {
        onDelete();
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Произошла ошибка при удалении";
      setError(errorMessage);
      setTimeout(() => setError(null), 3000);
    } finally {
      setDeletingId(null);
    }
  };

  const canDelete = (duty: Duty): boolean => {
    // Админ может удалять все записи
    if (isAdmin) {
      return true;
    }

    // Не админ может удалять только свою запись и только если она не утверждена
    if (duty.traders === currentTraderName && duty.utverzdeno !== true) {
      return true;
    }

    return false;
  };

  const handleUtverzdenoChange = async (duty: Duty, checked: boolean) => {
    if (!isAdmin) {
      return; // Не админ не может изменять
    }

    setUpdatingId(duty.id);
    setError(null);

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("dezurstva")
        .update({ utverzdeno: checked })
        .eq("id", duty.id);

      if (updateError) {
        throw updateError;
      }

      // Обновляем локальное состояние
      setDuties((prevDuties) =>
        prevDuties.map((d) =>
          d.id === duty.id ? { ...d, utverzdeno: checked } : d
        )
      );

      // Обновляем календарь
      if (onDelete) {
        onDelete();
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Произошла ошибка при обновлении";
      setError(errorMessage);
      setTimeout(() => setError(null), 3000);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>{formatDate(date)}</CardTitle>
            <CardDescription>
              {traders.length === 0
                ? "Нет записей на этот день"
                : `${traders.length} ${traders.length === 1 ? "запись" : "записей"}`}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {traders.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              На этот день нет записей
            </p>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}
              {duties.map((duty, index) => (
                <div
                  key={duty.id || index}
                  className="p-4 border rounded-lg bg-muted/50 flex items-start justify-between gap-4"
                >
                  <div className="flex-1">
                    <div className="font-medium mb-2">{duty.traders}</div>
                    {duty.tip_dezursva_or_otdyh && (
                      <div className="text-sm text-muted-foreground mb-2">
                        <span className="font-medium">Тип дежурства:</span> {duty.tip_dezursva_or_otdyh}
                      </div>
                    )}
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={`utverzdeno-${duty.id}`}
                        checked={duty.utverzdeno === true}
                        onCheckedChange={(checked) => handleUtverzdenoChange(duty, checked === true)}
                        disabled={!isAdmin || updatingId === duty.id}
                        className={cn(
                          !isAdmin && "opacity-50 cursor-not-allowed"
                        )}
                      />
                      <Label
                        htmlFor={`utverzdeno-${duty.id}`}
                        className={cn(
                          "text-sm font-medium leading-none cursor-pointer",
                          !isAdmin && "text-muted-foreground cursor-not-allowed"
                        )}
                      >
                        Утверждено
                      </Label>
                      {updatingId === duty.id && (
                        <div className="h-3 w-3 border-2 border-primary border-t-transparent rounded-full animate-spin ml-2" />
                      )}
                    </div>
                  </div>
                  {canDelete(duty) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(duty)}
                      disabled={deletingId === duty.id || updatingId === duty.id}
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                    >
                      {deletingId === duty.id ? (
                        <div className="h-4 w-4 border-2 border-destructive border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

