import type { Metadata } from "next";
import { MarketInfo } from "@/components/market-info";

export const metadata: Metadata = {
  title: "Справочник МосБиржи",
};

export default function MarketInfoPage() {
  return <MarketInfo />;
}
