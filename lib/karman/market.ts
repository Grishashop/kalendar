/**
 * Загрузка рыночных данных для страницы: справочник контрактов и котировки.
 *
 * Источники разные и падают независимо, поэтому и результат раздельный:
 * справочник публичный и работает всегда, котировки требуют рабочего токена
 * Alor (см. docs/adr/0006-kotirovki-alor-spravochnik-iss.md).
 */

import type { ContractInfo } from "./contracts";
import type { Quote } from "./pricing";

export interface ContractsResult {
  contracts: Record<string, ContractInfo | null>;
  loaded: boolean;
  error: string | null;
}

export interface QuotesResult {
  quotes: Record<string, Quote>;
  loaded: boolean;
  /** Причина, пригодная для показа оператору. */
  error: string | null;
  /** Момент загрузки — от него считается возраст на экране. */
  at: number;
}

/** Ответ Alor на `/md/v2/Securities/.../quotes`; берём только нужное. */
interface AlorQuote {
  description?: string;
  symbol?: string;
  bid?: number | null;
  ask?: number | null;
  last_price?: number | null;
  ob_ms_timestamp?: number | null;
}

const NETWORK_ERROR = "сеть недоступна";

export async function loadContracts(secids: readonly string[]): Promise<ContractsResult> {
  if (secids.length === 0) return { contracts: {}, loaded: true, error: null };

  try {
    const response = await fetch(`/api/karman/contracts?secids=${encodeURIComponent(secids.join(","))}`);
    if (!response.ok) {
      return {
        contracts: {},
        loaded: false,
        error:
          response.status === 503
            ? "справочник MOEX ISS недоступен"
            : `справочник не загрузился (${response.status})`,
      };
    }
    return {
      contracts: (await response.json()) as Record<string, ContractInfo | null>,
      loaded: true,
      error: null,
    };
  } catch {
    return { contracts: {}, loaded: false, error: NETWORK_ERROR };
  }
}

/**
 * Возраст считается от `ob_ms_timestamp` — времени стакана. Брать
 * `last_price_timestamp` нельзя: у неликвида он старый просто потому, что
 * сделок не было, и это не признак задержки ленты.
 */
export async function loadQuotes(secids: readonly string[]): Promise<QuotesResult> {
  const at = Date.now();
  if (secids.length === 0) return { quotes: {}, loaded: true, error: null, at };

  const symbols = secids.map((secid) => `MOEX:${secid}`).join(",");
  try {
    const response = await fetch(`/api/ticker/quotes?symbols=${encodeURIComponent(symbols)}`);
    if (!response.ok) {
      // Маршрут котировок закрыт входом: неавторизованного middleware уводит
      // редиректом на «/», и сюда прилетит HTML вместо JSON.
      const reason =
        response.status === 502
          ? "Alor не отвечает или токен недействителен"
          : `котировки не загрузились (${response.status})`;
      return { quotes: {}, loaded: false, error: reason, at };
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      return { quotes: {}, loaded: false, error: "требуется вход", at };
    }

    const quotes: Record<string, Quote> = {};
    for (const item of payload as AlorQuote[]) {
      const secid = item.description?.trim();
      if (!secid) continue;
      quotes[secid] = {
        bid: item.bid ?? null,
        ask: item.ask ?? null,
        last: item.last_price ?? null,
        ageSec: item.ob_ms_timestamp ? Math.round((at - item.ob_ms_timestamp) / 1000) : null,
      };
    }
    return { quotes, loaded: true, error: null, at };
  } catch {
    return { quotes: {}, loaded: false, error: NETWORK_ERROR, at };
  }
}
