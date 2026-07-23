import "server-only";
import type { Candle, SecuritySearchResult } from "@/lib/ticker/instruments";

const OAUTH_URL = "https://oauth.alor.ru/refresh";
const API_BASE = "https://api.alor.ru";

/** Запас времени перед истечением JWT, после которого токен считается непригодным. */
const EXPIRY_SAFETY_MARGIN_SEC = 60;

interface TokenCache {
  jwt: string;
  exp: number; // unix seconds
}

let tokenCache: TokenCache | null = null;

function decodeJwtExp(jwt: string): number {
  const payloadPart = jwt.split(".")[1];
  if (!payloadPart) {
    throw new Error("alor_auth_failed");
  }
  const payload = JSON.parse(
    Buffer.from(payloadPart, "base64url").toString("utf-8"),
  ) as { exp?: number };
  if (typeof payload.exp !== "number") {
    throw new Error("alor_auth_failed");
  }
  return payload.exp;
}

async function fetchAccessToken(): Promise<TokenCache> {
  const refreshToken = process.env.ALOR_TOKEN;
  if (!refreshToken) {
    throw new Error("alor_auth_failed");
  }
  const res = await fetch(
    `${OAUTH_URL}?token=${encodeURIComponent(refreshToken)}`,
    { method: "POST", cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error("alor_auth_failed");
  }
  const body = (await res.json()) as { AccessToken?: string };
  if (!body.AccessToken) {
    throw new Error("alor_auth_failed");
  }
  const exp = decodeJwtExp(body.AccessToken);
  return { jwt: body.AccessToken, exp };
}

/**
 * Возвращает свежий access token, либо null в анонимном режиме
 * (когда ALOR_TOKEN не задан) — тогда запросы к Alor идут
 * без заголовка Authorization и получают публичные данные с задержкой 15 мин.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!process.env.ALOR_TOKEN) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - now > EXPIRY_SAFETY_MARGIN_SEC) {
    return tokenCache.jwt;
  }
  tokenCache = await fetchAccessToken();
  return tokenCache.jwt;
}

/**
 * Обёртка над fetch к api.alor.ru. Прикладывает Bearer-токен, если он есть.
 * На 401 при наличии токена — один раз сбрасывает кэш и повторяет запрос.
 * Бросает Error("alor_auth_failed") при сбое обмена токена,
 * иначе Error("alor_unavailable: <status>") на прочие не-2xx ответы.
 */
export async function alorFetch(path: string): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });

  if (res.status === 401 && token) {
    tokenCache = null;
    const retryToken = await getAccessToken();
    const retryRes = await fetch(`${API_BASE}${path}`, {
      headers: retryToken ? { Authorization: `Bearer ${retryToken}` } : {},
      cache: "no-store",
    });
    if (!retryRes.ok) {
      throw new Error(`alor_unavailable: ${retryRes.status}`);
    }
    return retryRes.json();
  }

  if (!res.ok) {
    throw new Error(`alor_unavailable: ${res.status}`);
  }
  return res.json();
}

export async function searchSecurities(q: string): Promise<SecuritySearchResult[]> {
  const result = await alorFetch(`/md/v2/Securities?query=${encodeURIComponent(q)}&limit=10`);
  return Array.isArray(result) ? (result as SecuritySearchResult[]) : [];
}

/** Полный список инструментов биржи (без лимита) — требует токен, анонимно недоступно. Для синхронизации внутренней БД. */
export async function listAllSecurities(exchange: string): Promise<SecuritySearchResult[]> {
  if (!(await getAccessToken())) {
    throw new Error("alor_auth_failed");
  }
  const result = await alorFetch(`/md/v2/Securities/${encodeURIComponent(exchange)}`);
  return Array.isArray(result) ? (result as SecuritySearchResult[]) : [];
}

/** symbols в формате "MOEX:SBER,MOEX:LKOH" */
export async function getQuotes(symbols: string): Promise<unknown> {
  return alorFetch(
    `/md/v2/Securities/${encodeURIComponent(symbols)}/quotes`,
  );
}

/** Последние `days` дневных свечей (tf=D) для инструмента. */
export async function getHistory(
  exchange: string,
  symbol: string,
  days: number,
): Promise<Candle[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 2 * 24 * 3600; // с запасом на выходные/праздники
  const path =
    `/md/v2/history?symbol=${encodeURIComponent(symbol)}` +
    `&exchange=${encodeURIComponent(exchange)}&tf=D&from=${from}&to=${to}&format=Simple`;
  const result = (await alorFetch(path)) as { history?: unknown };
  const history = Array.isArray(result.history) ? (result.history as Candle[]) : [];
  return history.slice(-days);
}
