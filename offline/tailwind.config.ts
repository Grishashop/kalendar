// Отдельный конфиг Tailwind для офлайн-сборки: сканируется только то, что в неё
// входит, иначе в единственный файл уедут классы всех разделов сайта.
import type { Config } from "tailwindcss";
import base from "../tailwind.config";

export default {
  ...base,
  darkMode: ["class"],
  content: [
    "./offline/entry.tsx",
    "./components/karman/**/*.tsx",
    "./components/ui/**/*.tsx",
    "./components/ticker/Collapsible.tsx",
  ],
} satisfies Config;
