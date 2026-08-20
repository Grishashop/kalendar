import { get, put } from "@vercel/blob";
import { NextResponse } from "next/server";

// Календарь дежурств отдела поддержки клиентов. Отдельный файл и отдельный
// пароль от календаря трейдеров (/api/temp-calendar): отделы не должны править
// расписание друг друга.
//
// Смены хранятся рядом с днями, потому что у отдела свои: угадывать их за него
// в коде неправильно, а держать в переменных окружения — неудобно ему же.

// Без этого GET не читает динамические данные (нет cookies/headers/searchParams),
// поэтому Next.js статически закэшировал бы самый первый ответ навсегда.
export const dynamic = "force-dynamic";

const PATHNAME = "support-calendar/data.json";

interface DutyType {
  name: string;
  color: string;
}

interface Payload {
  /** «ГГГГ-ММ-ДД» → строки вида «Имя — Смена» / «Имя — Смена (не утв.)». */
  days: Record<string, string[]>;
  types: DutyType[];
}

/**
 * Начальные смены — заведомо предположение: настоящие названия знает только сам
 * отдел, и он правит их на странице. Поэтому здесь общий набор, а не выдуманная
 * специфика, которая выглядела бы как согласованная.
 */
const DEFAULT_TYPES: DutyType[] = [
  { name: "Первая смена", color: "#93C5FD" },
  { name: "Вторая смена", color: "#FACC15" },
  { name: "Ночь", color: "#8B5A2B" },
  { name: "Отгул", color: "#EF4444" },
  { name: "Отпуск", color: "#A3A3A3" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

async function readPayload(): Promise<Payload> {
  try {
    const result = await get(PATHNAME, { access: "public" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return { days: {}, types: DEFAULT_TYPES };
    }
    const text = await new Response(result.stream).text();
    const parsed = JSON.parse(text || "{}") as Partial<Payload>;
    return {
      days: parsed.days ?? {},
      types: Array.isArray(parsed.types) && parsed.types.length > 0 ? parsed.types : DEFAULT_TYPES,
    };
  } catch {
    return { days: {}, types: DEFAULT_TYPES };
  }
}

async function write(payload: Payload): Promise<void> {
  await put(PATHNAME, JSON.stringify(payload), {
    access: "public",
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export async function GET() {
  const payload = await readPayload();
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const { password, date, names, types } = (body ?? {}) as {
    password?: string;
    date?: string;
    names?: unknown;
    types?: unknown;
  };

  const expected = process.env.SUPPORT_CALENDAR_PASSWORD;
  if (!expected) {
    // 503, а не 401: пароль не «неверный», его вообще не задали. Разные причины
    // требуют разных действий — от пользователя ничего не зависит.
    return NextResponse.json({ error: "support_password_not_configured" }, { status: 503 });
  }
  if (password !== expected) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  const payload = await readPayload();

  // Правка смен и правка дня — разные запросы: смешивать их значит переписать
  // расписание отдела при обычном сохранении одного дня.
  if (types !== undefined) {
    if (!Array.isArray(types) || types.length === 0) {
      return NextResponse.json({ error: "Нужен хотя бы один тип смены" }, { status: 400 });
    }
    const cleaned: DutyType[] = [];
    for (const item of types.slice(0, 20)) {
      const name = String((item as DutyType)?.name ?? "").trim();
      const color = String((item as DutyType)?.color ?? "");
      if (!name) continue;
      if (!HEX.test(color)) {
        return NextResponse.json({ error: `Некорректный цвет смены «${name}»` }, { status: 400 });
      }
      if (!cleaned.some((existing) => existing.name === name)) cleaned.push({ name, color });
    }
    if (cleaned.length === 0) {
      return NextResponse.json({ error: "Нужен хотя бы один тип смены" }, { status: 400 });
    }
    payload.types = cleaned;
    await write(payload);
    return NextResponse.json(payload);
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

  if (cleanedNames.length === 0) {
    delete payload.days[date];
  } else {
    payload.days[date] = cleanedNames;
  }

  await write(payload);
  return NextResponse.json(payload);
}
