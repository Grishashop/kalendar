import { NextResponse } from "next/server";
import { fetchIssBlocks, issRowsToObjects } from "@/lib/ticker/moexIss";
import type { Amortization, Coupon, CouponSchedule } from "@/lib/ticker/instruments";

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  const empty: CouponSchedule = { coupons: [], amortizations: [] };
  if (!symbol) {
    return NextResponse.json(empty);
  }

  const url = `https://iss.moex.com/iss/statistics/engines/stock/markets/bonds/bondization/${encodeURIComponent(symbol)}.json?iss.meta=off`;
  const blocks = await fetchIssBlocks(url);

  const coupons: Coupon[] = blocks.coupons
    ? issRowsToObjects(blocks.coupons)
        .map((row) => ({
          couponDate: String(row.coupondate ?? ""),
          value: Number(row.value ?? 0),
          valuePercent: Number(row.valueprc ?? 0),
        }))
        .filter((coupon) => coupon.couponDate.length > 0)
        .sort((a, b) => (a.couponDate < b.couponDate ? -1 : 1))
    : [];

  const amortizations: Amortization[] = blocks.amortizations
    ? issRowsToObjects(blocks.amortizations)
        .map((row) => ({
          amortDate: String(row.amortdate ?? ""),
          value: Number(row.value ?? 0),
          valuePercent: Number(row.valueprc ?? 0),
        }))
        .filter((amortization) => amortization.amortDate.length > 0)
        .sort((a, b) => (a.amortDate < b.amortDate ? -1 : 1))
    : [];

  return NextResponse.json({ coupons, amortizations } satisfies CouponSchedule);
}
