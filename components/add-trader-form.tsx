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

interface AddTraderFormProps {
  userEmail: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function AddTraderForm({ userEmail, onSuccess, onCancel }: AddTraderFormProps) {
  const [name, setName] = useState("");
  const [nameShort, setNameShort] = useState("");
  const [photo, setPhoto] = useState("");
  const [mail, setMail] = useState(userEmail);
  const [phone, setPhone] = useState("");
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
      const { error: insertError } = await supabase.from("traders").insert({
        name,
        name_short: nameShort,
        photo: photo || null,
        mail,
        phone: phone || null,
      });

      if (insertError) {
        throw insertError;
      }

      onSuccess();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Произошла ошибка при добавлении";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Добавить себя в список трейдеров</CardTitle>
          <CardDescription>
            Заполните форму для добавления вашей информации
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
                disabled
                className="bg-muted cursor-not-allowed"
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

            {error && (
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" className="flex-1" disabled={isLoading}>
                {isLoading ? "Добавление..." : "Добавить"}
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
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

