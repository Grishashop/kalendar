import { NextResponse } from "next/server";
import { fetchIssBlocks, issRowsToObjects } from "@/lib/ticker/moexIss";
import type { Dividend } from "@/lib/ticker/instruments";

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  if (!symbol) {
    return NextResponse.json([]);
  }

  const blocks = await fetchIssBlocks(
    `https://iss.moex.com/iss/securities/${encodeURIComponent(symbol)}/dividends.json?iss.meta=off`,
  );
  const table = blocks.dividends;
  if (!table) {
    return NextResponse.json([]);
  }

  const dividends: Dividend[] = issRowsToObjects(table)
    .map((row) => ({
      registryCloseDate: String(row.registryclosedate ?? ""),
      value: Number(row.value ?? 0),
      currency: String(row.currencyid ?? "RUB"),
    }))
    .filter((dividend) => dividend.registryCloseDate.length > 0)
    .sort((a, b) => (a.registryCloseDate < b.registryCloseDate ? 1 : -1));

  return NextResponse.json(dividends);
}
