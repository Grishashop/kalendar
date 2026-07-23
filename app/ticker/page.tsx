import type { Metadata } from "next";
import { Dashboard } from "@/components/ticker/Dashboard";

// Доступ — только через существующий вход kalendar: middleware.ts уже редиректит
// неавторизованных на "/" для любого пути, кроме явно исключённых (/login, /auth,
// /temp-calendar, /market, ...) — "/ticker" в этот список не входит, отдельная
// проверка здесь не нужна (см. app/protected/page.tsx — тот же паттерн).
export const metadata: Metadata = {
  title: "Монитор котировок",
};

export default function TickerPage() {
  return <Dashboard />;
}
