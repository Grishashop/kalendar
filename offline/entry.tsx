// Точка входа офлайн-сборки «Кармана транзакций»: один HTML-файл, который
// открывается двойным щелчком внутри организации, без выхода в интернет.
//
// Собирается тем же кодом, что и страница сайта (components/karman/Generator),
// а не копией: расчёт цены, разбор вставки и сверка объёма — то, где ошибка
// стоит денег, и держать это в двух местах нельзя.
//
// Сборка — npm run build:offline, скрипт offline/build.mjs.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { Generator } from "@/components/karman/Generator";
import { Toaster } from "@/components/ui/sonner";

const root = document.getElementById("root");
if (!root) throw new Error("Не найден контейнер #root");

createRoot(root).render(
  <StrictMode>
    {/* Тема фиксирована: системную определять нечем, а «прыжок» цвета при
        открытии файла выглядит как сбой. Тёмная — как на странице сайта. */}
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
      <Generator offline />
      <Toaster position="top-right" />
    </ThemeProvider>
  </StrictMode>,
);
