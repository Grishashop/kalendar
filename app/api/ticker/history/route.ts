import { NextResponse } from "next/server";
import { getHistory } from "@/lib/ticker/alor";

const CANDLE_COUNT = 14;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const exchange = params.get("exchange") ?? "";
  const symbol = params.get("symbol") ?? "";
  if (!exchange || !symbol) {
    return NextResponse.json([]);
  }

  try {
    const candles = await getHistory(exchange, symbol, CANDLE_COUNT);
    return NextResponse.json(candles);
  } catch (error) {
    if (error instanceof Error && error.message === "alor_auth_failed") {
      return NextResponse.json({ error: "alor_auth_failed" }, { status: 502 });
    }
    return NextResponse.json({ error: "alor_unavailable" }, { status: 502 });
  }
}
