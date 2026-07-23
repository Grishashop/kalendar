import { NextResponse } from "next/server";
import { getSyncStatus, syncInstruments } from "@/lib/ticker/instrumentsDb";

// Полная синхронизация тянет весь список инструментов MOEX и делает пачку upsert —
// на Hobby-плане с Fluid Compute укладывается с запасом в 300 с, но 10 с дефолтного
// лимита точно не хватит.
export const maxDuration = 60;

const MAX_ERROR_MESSAGE_LEN = 500;

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause.message : error.cause;
    const message = error.message.slice(0, MAX_ERROR_MESSAGE_LEN);
    return cause ? `cause: ${cause} | ${message}` : message;
  }
  return String(error);
}

export async function GET() {
  try {
    const status = await getSyncStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ error: "db_unavailable", message: serializeError(error) }, { status: 502 });
  }
}

/** Актуализация: полный список MOEX из Alor -> upsert во внутреннюю БД. */
export async function POST() {
  try {
    const status = await syncInstruments();
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof Error && error.message === "alor_auth_failed") {
      return NextResponse.json({ error: "alor_auth_failed" }, { status: 502 });
    }
    return NextResponse.json({ error: "sync_failed", message: serializeError(error) }, { status: 502 });
  }
}
