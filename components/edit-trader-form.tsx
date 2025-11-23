"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

interface TraderDetails {
  id: string | number;
  name?: string;
  name_short?: string;
  photo?: string;
  mail?: string;
  phone?: string;
  mozno_dezurit?: boolean;
  admin?: boolean;
}

interface EditTraderFormProps {
  trader: TraderDetails;
  isAdmin: boolean;
  onSuccess: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function EditTraderForm({
  trader,
  isAdmin,
  onSuccess,
  onCancel,
  onDelete,
}: EditTraderFormProps) {
  const [name, setName] = useState(trader.name || "");
  const [nameShort, setNameShort] = useState(trader.name_short || "");
  const [photo, setPhoto] = useState(trader.photo || "");
  const [mail, setMail] = useState(trader.mail || "");
  const [phone, setPhone] = useState(trader.phone || "");
  const [moznoDezurit, setMoznoDezurit] = useState(trader.mozno_dezurit || false);
  const [admin, setAdmin] = useState(trader.admin || false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (!name || !nameShort || !mail) {
      setError("Поля ФИО, Краткое имя и Почта обязательны для заполнения");
      setIsLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const updateData: {
        name: string;
        name_short: string;
        photo: string | null;
        mail: string;
        phone: string | null;
        mozno_dezurit?: boolean;
        admin?: boolean;
      } = {
        name,
        name_short: nameShort,
        photo: photo || null,
        mail,
        phone: phone || null,
      };
      
      // Только админ может изменять mozno_dezurit и admin
      if (isAdmin) {
        updateData.mozno_dezurit = moznoDezurit;
        updateData.admin = admin;
      }
      
      const { error: updateError } = await supabase
        .from("traders")
        .update(updateData)
        .eq("id", trader.id);

      if (updateError) {
        throw updateError;
      }

      onSuccess();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Произошла ошибка при обновлении";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    const confirmMessage = "Вы уверены, что хотите удалить этого трейдера?\n\n" +
      "ВНИМАНИЕ: Будут удалены все связанные записи:\n" +
      "- Все дежурства этого трейдера\n" +
      "- Все заметки и папки\n" +
      "- Все сообщения в чате\n\n" +
      "Это действие нельзя отменить!";
    
    if (!confirm(confirmMessage)) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      
      // Преобразуем id в число, если это строка
      const traderId = typeof trader.id === 'string' ? parseInt(trader.id, 10) : trader.id;
      
      // Проверяем, что id валидный
      if (isNaN(traderId as number)) {
        throw new Error("Неверный ID трейдера");
      }

      // Получаем имя трейдера для удаления связанных записей в dezurstva
      const traderNameShort = trader.name_short;

      // Шаг 1: Удаляем все дежурства этого трейдера (dezurstva использует TEXT поле traders)
      if (traderNameShort) {
        const { error: deleteDutiesError } = await supabase
          .from("dezurstva")
          .delete()
          .eq("traders", traderNameShort);

        if (deleteDutiesError) {
          console.error("Error deleting duties:", deleteDutiesError);
          // Не прерываем выполнение, продолжаем удаление трейдера
        }
      }

      // Шаг 2: Удаляем трейдера
      // Заметки, папки и сообщения удалятся автоматически благодаря ON DELETE CASCADE
      const { error: deleteError } = await supabase
        .from("traders")
        .delete()
        .eq("id", traderId);

      if (deleteError) {
        console.error("Delete error details:", deleteError);
        console.error("Trader ID:", traderId, "Type:", typeof traderId);
        
        // Проверяем специфичные ошибки
        if (deleteError.code === '23503' || 
            deleteError.message?.includes("foreign key") || 
            deleteError.message?.includes("violates foreign key")) {
          throw new Error(
            "Нельзя удалить трейдера, так как он связан с другими записями. " +
            "Попробуйте удалить связанные записи вручную через панель администратора."
          );
        }
        
        throw deleteError;
      }

      if (onDelete) {
        onDelete();
      }
    } catch (err: unknown) {
      console.error("Delete error:", err);
      let errorMessage = "Произошла ошибка при удалении";
      
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (err && typeof err === 'object' && 'message' in err) {
        errorMessage = String(err.message);
      }
      
      // Проверяем специфичные ошибки Supabase
      if (errorMessage.includes("foreign key") || errorMessage.includes("violates foreign key")) {
        errorMessage = "Нельзя удалить трейдера, так как он связан с другими записями. " +
          "Попробуйте удалить связанные записи вручную через панель администратора.";
      } else if (errorMessage.includes("permission denied") || errorMessage.includes("policy")) {
        errorMessage = "У вас нет прав для удаления этого трейдера. Проверьте настройки безопасности в Supabase.";
      } else if (errorMessage.includes("column") && errorMessage.includes("does not exist")) {
        errorMessage = "Ошибка структуры базы данных. Проверьте, что таблица traders существует и имеет колонку id.";
      }
      
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>Редактировать трейдера</CardTitle>
          <CardDescription>
            Измените информацию о трейдере
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">ФИО трейдера *</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Иванов Иван Иванович"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name_short">Краткое имя трейдера *</Label>
              <Input
                id="name_short"
                type="text"
                value={nameShort}
                onChange={(e) => setNameShort(e.target.value)}
                required
                placeholder="И.И. Иванов"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="photo">Фото трейдера (ссылка)</Label>
              <Input
                id="photo"
                type="url"
                value={photo}
                onChange={(e) => setPhoto(e.target.value)}
                placeholder="https://example.com/photo.jpg"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mail">Почта трейдера *</Label>
              <Input
                id="mail"
                type="email"
                value={mail}
                onChange={(e) => setMail(e.target.value)}
                required
                placeholder="example@mail.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Телефон трейдера</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 (999) 123-45-67"
              />
            </div>

            <div className="space-y-2">
              <Label>Можно дежурить</Label>
              {isAdmin ? (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="mozno_dezurit"
                    checked={moznoDezurit}
                    onCheckedChange={(checked) => setMoznoDezurit(checked === true)}
                  />
                  <Label
                    htmlFor="mozno_dezurit"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {moznoDezurit ? "Да" : "Нет"}
                  </Label>
                </div>
              ) : (
                <div className="p-2 rounded-md bg-muted border">
                  <p className="text-sm">
                    {moznoDezurit ? "Да" : "Нет"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Только администратор может изменить это поле
                  </p>
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="space-y-2">
                <Label>Администратор</Label>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="admin"
                    checked={admin}
                    onCheckedChange={(checked) => setAdmin(checked === true)}
                  />
                  <Label
                    htmlFor="admin"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {admin ? "Да" : "Нет"}
                  </Label>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" className="flex-1" disabled={isLoading}>
                {isLoading ? "Сохранение..." : "Сохранить"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={onCancel}
                disabled={isLoading}
              >
                Отменить
              </Button>
            </div>

            {isAdmin && onDelete && (
              <Button
                type="button"
                variant="destructive"
                className="w-full mt-2"
                onClick={handleDelete}
                disabled={isLoading}
              >
                Удалить
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

