import { timingSafeEqual } from "crypto";

/** Сравнение секретов за постоянное время (без утечки по длине общего префикса). */
export function safeEqual(a: unknown, b: string): boolean {
  if (typeof a !== "string") return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
