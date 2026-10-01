import Image from "next/image";
import type { ReactNode } from "react";
import { AuthButtonClient } from "@/components/auth-button-client";
import { ThemeSwitcher } from "@/components/theme-switcher";

interface AppHeaderProps {
  /** Середина шапки: подпись о том, кто вошёл, и сопутствующие элементы. */
  center: ReactNode;
  /** Кнопки разделов слева от переключателя темы. */
  nav?: ReactNode;
}

/**
 * Общая шапка главной и `/protected`: логотип, середина, переключатель темы и
 * вход. Раньше разметка была продублирована в обеих страницах, и правка стиля
 * требовала двух одинаковых изменений.
 */
export function AppHeader({ center, nav }: AppHeaderProps) {
  return (
    <header className="w-full border-b border-b-foreground/10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
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

          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
            {center}
          </div>

          <div className="flex items-center gap-3">
            {nav}
            <ThemeSwitcher />
            <AuthButtonClient />
          </div>
        </div>
      </div>
    </header>
  );
}
