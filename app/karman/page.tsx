import type { Metadata } from "next";
import { Generator } from "@/components/karman/Generator";

// Доступ — через существующий вход kalendar: middleware.ts редиректит
// неавторизованных на "/" для любого пути, кроме явно исключённых, и "/karman"
// в этот список не входит (см. lib/supabase/middleware.ts).
export const metadata: Metadata = {
  title: "Карман транзакций",
};

export default function KarmanPage() {
  return <Generator />;
}
