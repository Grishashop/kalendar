import { get, put } from "@vercel/blob";
import { NextResponse } from "next/server";

// Временное хранилище расписания дежурств, пока Supabase заблокирован
// по превышению лимита egress (см. supabase/00_bootstrap_new_project.sql
// для миграции на новый проект). Данные хранятся в Vercel Blob как один
// JSON-файл: { "YYYY-MM-DD": ["Имя 1", "Имя 2"] }.

// Без этого GET не читает динамические данные (нет cookies/headers/searchParams),
// поэтому Next.js статически закэшировал бы самый первый ответ навсегда.
export const dynamic = "force-dynamic";

const PATHNAME = "temp-calendar/data.json";

type CalendarData = Record<string, string[]>;

async function readData(): Promise<CalendarData> {
  try {
    const result = await get(PATHNAME, { access: "public" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return {};
    }
    const text = await new Response(result.stream).text();
    const parsed = JSON.parse(text || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export async function GET() {
  const data = await readData();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const { password, date, names } = (body ?? {}) as {
    password?: string;
    date?: string;
    names?: unknown;
  };

  if (!process.env.TEMP_CALENDAR_PASSWORD || password !== process.env.TEMP_CALENDAR_PASSWORD) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
  }

  if (!Array.isArray(names)) {
    return NextResponse.json({ error: "Некорректный список дежурных" }, { status: 400 });
  }

  const cleanedNames = names
    .map((n) => String(n).trim())
    .filter(Boolean)
    .slice(0, 20);

  const data = await readData();
  if (cleanedNames.length === 0) {
    delete data[date];
  } else {
    data[date] = cleanedNames;
  }

  await put(PATHNAME, JSON.stringify(data), {
    access: "public",
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });

  return NextResponse.json({ ok: true, data });
}

// Полная замена всего датасета одним запросом (используется для разового
// импорта из Supabase). В отличие от POST не делает read-modify-write,
// поэтому не подвержен гонке при последовательных быстрых вызовах.
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const { password, data } = (body ?? {}) as { password?: string; data?: unknown };

  if (!process.env.TEMP_CALENDAR_PASSWORD || password !== process.env.TEMP_CALENDAR_PASSWORD) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  await put(PATHNAME, JSON.stringify(data), {
    access: "public",
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });

  return NextResponse.json({ ok: true, data });
}
