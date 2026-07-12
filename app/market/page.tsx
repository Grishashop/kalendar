import type { Metadata } from "next";
import { MarketDashboard } from "@/components/market-dashboard";

export const metadata: Metadata = {
  title: "Российский рынок — обзор",
};

export default function MarketPage() {
  return <MarketDashboard />;
}
