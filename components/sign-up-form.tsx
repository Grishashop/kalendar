"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Функция для перевода ошибок Supabase на русский
const translateError = (errorMessage: string): string => {
  const errorTranslations: Record<string, string> = {
    "Email not confirmed": "Email не подтвержден",
    "Invalid login credentials": "Неверный email или пароль",
    "User already registered": "Пользователь уже зарегистрирован",
    "Password should be at least 6 characters": "Пароль должен содержать минимум 6 символов",
    "Unable to validate email address: invalid format": "Неверный формат email адреса",
    "User not found": "Пользователь не найден",
    "Email rate limit exceeded": "Превышен лимит запросов. Попробуйте позже",
  };

  // Проверяем точное совпадение
  if (errorTranslations[errorMessage]) {
    return errorTranslations[errorMessage];
  }

  // Проверяем частичное совпадение (для ошибок с дополнительным текстом)
  for (const [key, value] of Object.entries(errorTranslations)) {
    if (errorMessage.includes(key)) {
      return value;
    }
  }

  return errorMessage;
};

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    if (password !== repeatPassword) {
      setError("Пароли не совпадают");
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/protected`,
        },
      });
      if (error) {
        setError(translateError(error.message));
        setIsLoading(false);
        return;
      }
      
      // Если подтверждение email отключено, пользователь сразу получает сессию
      // и мы перенаправляем его на защищенную страницу
      // Если подтверждение email включено, сессии не будет и показываем страницу с инструкциями
      if (data.session) {
        router.push("/protected");
      } else {
      router.push("/auth/sign-up-success");
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Произошла ошибка";
      setError(translateError(errorMessage));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Регистрация</CardTitle>
          <CardDescription>Создайте новый аккаунт</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Пароль</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="repeat-password">Повторите пароль</Label>
                </div>
                <Input
                  id="repeat-password"
                  type="password"
                  required
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Создание аккаунта..." : "Зарегистрироваться"}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              Уже есть аккаунт?{" "}
              <Link href="/auth/login" className="underline underline-offset-4">
                Войти
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
