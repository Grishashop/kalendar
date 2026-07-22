// T-Bank (бывш. Тинькофф) Invest API — InstrumentsService.GetDividends.
// Даёт заметно более свежие данные по дивидендам, чем MOEX ISS
// /iss/securities/{secid}/dividends.json (проверено вживую: у ISS SBER
// обрывается на 2025-07-18, у T-Bank уже есть запись с recordDate
// 2026-07-20 — MOEX сам не успевает публиковать это в своём API).
// Используется как основной источник; MOEX ISS остаётся фолбэком на
// случай отсутствия токена или сбоя запроса — см. вызывающий код.
//
// Токен — server-only секрет (TBANK_INVEST_TOKEN), НИКОГДА не должен
// попадать в клиентский код. Получить: T-Bank Инвестиции -> Настройки ->
// «Создать токен» (доступа Readonly достаточно, торговые права не нужны).

const TBANK_BASE =
  "https://invest-public-api.tbank.ru/rest/tinkoff.public.invest.api.contract.v1.InstrumentsService";

export interface TBankDividend {
  recordDate: string; // "YYYY-MM-DD" — дата закрытия реестра
  value: number;
  currency: string;
}

function moneyValueToNumber(v: { units?: string; nano?: number } | undefined): number {
  if (!v) return 0;
  const units = Number(v.units ?? 0);
  const nano = (v.nano ?? 0) / 1e9;
  return units + nano;
}

async function tbankFetch(method: string, body: Record<string, unknown>): Promise<unknown> {
  const token = process.env.TBANK_INVEST_TOKEN;
  if (!token) throw new Error("TBANK_INVEST_TOKEN не задан");

  let lastErr: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(`${TBANK_BASE}/${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        // Дивиденды публикуются нечасто — 6 часов, тот же паттерн, что и
        // у MOEX-фетчей в lib/moex/iss.ts.
        next: { revalidate: 21600 },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`T-Bank HTTP ${res.status} для ${method}: ${errBody.slice(0, 300)}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i === 0) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 400);
        await promise;
      }
    }
  }
  const cause = lastErr instanceof Error ? (lastErr.cause ?? lastErr.message) : lastErr;
  console.error(`T-Bank ${method} не удался:`, cause);
  throw lastErr;
}

// T-Bank instrument_uid (площадка TQBR/MOEX) для тикеров из SECTOR_GROUPS
// (lib/moex/sectors.ts) — сверены вживую через FindInstrument заранее,
// чтобы не тратить лишний резолв-запрос на каждый тикер при каждой
// загрузке /api/market/events.
export const TICKER_TO_TBANK_UID: Record<string, string> = {
  LKOH: "02cfdf61-6298-4c0f-a9ca-9cabc82afaf3",
  GAZP: "962e2a95-02a9-4171-abd7-aa198dbe643a",
  TATN: "88468f6c-c67a-4fb4-a006-53eed803883c",
  NVTK: "0da66728-6c30-44c4-9264-df8fac2467ee",
  ROSN: "fd417230-19cf-4e7b-9623-f7c9ca18ec6b",
  SNGS: "1ffe1bff-d7b7-4b04-b482-34dc9cc0a4ba",
  TRNFP: "653d47e9-dbd4-407a-a1c3-47f897df4694",
  SBER: "e6123145-9665-43e0-8413-cd61b8aa9b13",
  T: "87db07bc-0e02-4e29-90bb-05e8ef791d7b",
  VTBR: "8e2b0325-0292-4654-8a18-4f63ed3b0e09",
  MOEX: "5e1c2634-afc4-4e50-ad6d-f78fc14a539a",
  CBOM: "ebfda284-4291-4337-9dfb-f55610d0a907",
  DOMRF: "aac2b935-3d94-4030-83a1-f7acdd9b05a5",
  SVCB: "1fbecbbc-ef32-448c-b4fe-b0037795ba01",
  GMKN: "509edd0c-129c-4ee2-934d-7f6246126da1",
  PLZL: "10620843-28ce-44e8-80c2-f26ceb1bd3e1",
  CHMF: "fa6aae10-b8d5-48c8-bbfd-d320d925d096",
  RUAL: "f866872b-8f68-4b6e-930f-749fe9aa79c0",
  NLMK: "161eb0d0-aaac-4451-b374-f5d0eeb1b508",
  MAGN: "7132b1c9-ee26-4464-b5b5-1046264b61d9",
  ALRS: "30817fea-20e6-4fee-ab1f-d20fc1a1bb72",
  IRAO: "2dfbc1fd-b92a-436e-b011-928c79e805f2",
  MSNG: "98fc1318-6990-4147-b0d1-b10999326461",
  AFLT: "1c69e020-f3b1-455c-affa-45f8b8049234",
  FLOT: "21423d2d-9009-4d37-9325-883b368d13ae",
  PHOR: "9978b56f-782a-4a80-a4b1-a48cbecfd194",
  YDEX: "7de75794-a27f-4d81-a39b-492345813822",
  HEAD: "3fe80143-1313-42eb-9884-5d68b39e265e",
  VKCO: "b71bd174-c72c-41b0-a66f-5f9073e0d1f5",
  POSI: "de08affe-4fbd-454e-9fd1-46a81b23f870",
  CNRU: "b125d6c0-e90b-49be-8b75-f7e1990250a0",
  OZON: "75e003c2-ca14-4980-8d7b-e82ec6b6ffe1",
  X5: "0964acd0-e2cb-4810-a177-ef4ad8856ff0",
  LENT: "5f1e6b0a-4413-489c-b336-40b43730eaf5",
  RAGR: "9b9a584e-448f-40da-9ba8-353b44ad697a",
  MDMG: "0d53d29a-3794-41c6-ba72-556d46bacb46",
  MTSS: "cd8063ad-73ad-4b31-bd0d-93138d9e99a2",
  RTKM: "02eda274-10c4-4815-8e02-a8ee7eaf485b",
};

export async function getDividendsByUid(
  uid: string,
  fromIso: string,
  toIso: string,
): Promise<TBankDividend[]> {
  const json = (await tbankFetch("GetDividends", {
    instrumentId: uid,
    from: fromIso,
    to: toIso,
  })) as { dividends?: unknown[] };

  const rows = Array.isArray(json.dividends) ? json.dividends : [];
  return rows
    .map((r) => {
      const row = r as Record<string, unknown>;
      const recordDate = typeof row["recordDate"] === "string" ? row["recordDate"] : null;
      if (!recordDate) return null;
      const money = row["dividendNet"] as
        | { units?: string; nano?: number; currency?: string }
        | undefined;
      return {
        recordDate: recordDate.slice(0, 10),
        value: moneyValueToNumber(money),
        currency: (money?.currency ?? "rub").toUpperCase(),
      } satisfies TBankDividend;
    })
    .filter((d): d is TBankDividend => d !== null);
}

// Резолвит T-Bank instrument_uid по тикеру на площадке TQBR (MOEX) — для
// инструментов вне TICKER_TO_TBANK_UID (карточка в /market/info ищет
// произвольную бумагу, а не только фиксированный список SECTOR_GROUPS).
export async function findTqbrInstrumentUid(ticker: string): Promise<string | null> {
  const json = (await tbankFetch("FindInstrument", {
    query: ticker,
    instrumentKind: "INSTRUMENT_TYPE_SHARE",
  })) as { instruments?: unknown[] };

  const rows = Array.isArray(json.instruments) ? json.instruments : [];
  const match = rows.find((r) => {
    const row = r as Record<string, unknown>;
    return row["ticker"] === ticker && row["classCode"] === "TQBR";
  }) as Record<string, unknown> | undefined;

  return typeof match?.["uid"] === "string" ? match["uid"] : null;
}
