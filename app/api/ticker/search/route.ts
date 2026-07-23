import { NextResponse } from "next/server";
import { searchInstruments } from "@/lib/ticker/instrumentsDb";

/** Поиск по внутренней БД инструментов (только MOEX) — без обращений к Alor на каждый набор символа. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const trimmed = q.trim();
  if (trimmed.length < 2) {
    return NextResponse.json({ results: [], fuzzy: false });
  }

  try {
    const outcome = await searchInstruments(trimmed);
    return NextResponse.json(outcome);
  } catch (error) {
    return NextResponse.json({ error: "db_unavailable", message: String(error) }, { status: 502 });
  }
}
