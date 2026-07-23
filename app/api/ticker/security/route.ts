import { NextResponse } from "next/server";
import { searchSecurities } from "@/lib/ticker/alor";

/**
 * Свежая карточка инструмента (маржа, ценовой коридор и т.п.) — эти поля не входят
 * в /quotes, только в поиск, поэтому запрашиваем точным тикером отдельно.
 */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  if (!symbol) {
    return NextResponse.json(null);
  }

  try {
    const results = await searchSecurities(symbol);
    const exact = results.find((result) => result.symbol === symbol) ?? null;
    return NextResponse.json(exact);
  } catch (error) {
    if (error instanceof Error && error.message === "alor_auth_failed") {
      return NextResponse.json({ error: "alor_auth_failed" }, { status: 502 });
    }
    return NextResponse.json({ error: "alor_unavailable" }, { status: 502 });
  }
}
