import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/ticker/alor";

export async function GET(request: Request) {
  const symbols = new URL(request.url).searchParams.get("symbols") ?? "";
  if (symbols.trim().length === 0) {
    return NextResponse.json([]);
  }

  try {
    const quotes = await getQuotes(symbols.trim());
    return NextResponse.json(quotes);
  } catch (error) {
    if (error instanceof Error && error.message === "alor_auth_failed") {
      return NextResponse.json({ error: "alor_auth_failed" }, { status: 502 });
    }
    return NextResponse.json({ error: "alor_unavailable" }, { status: 502 });
  }
}
