"use client";

import Link from "next/link";
import { Button } from "./ui/button";
import { createClient } from "@/lib/supabase/client";
import { LogoutButton } from "./logout-button";
import { useEffect, useState } from "react";

export function AuthButtonClient() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkUser = async () => {
      // Проверка переменных окружения
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
        setLoading(false);
        return;
      }
      
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
    };

    checkUser();

    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled>
          Загрузка...
        </Button>
      </div>
    );
  }

  return user ? (
    <div className="flex items-center gap-4">
      <span className="text-sm hidden md:inline">Привет, {user.email}!</span>
      <LogoutButton />
    </div>
  ) : (
    <div className="flex gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href="/auth/login">Войти</Link>
      </Button>
      <Button asChild size="sm" variant="default">
        <Link href="/auth/sign-up">Регистрация</Link>
      </Button>
    </div>
  );
}

