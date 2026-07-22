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

import { Agent, fetch as undiciFetch } from "undici";
import tls from "node:tls";
import { unstable_cache } from "next/cache";

// T-Bank (как и другие крупные российские банки) с 2022 года использует TLS-
// сертификат, выданный государственным «Russian Trusted CA» (Минцифры РФ) —
// западные CA перестали продлевать сертификаты для попавших под санкции
// российских организаций. Этот корневой центр не входит в доверенный список
// ни у одной ОС/рантайма за пределами России, поэтому обычный fetch() падает
// с SELF_SIGNED_CERT_IN_CHAIN (проверено вживую и в песочнице, и в проде на
// Vercel). Правильное решение — добавить этот CA в доверенные (а не
// отключать проверку сертификата вовсе, что было бы дырой в безопасности
// для запроса с Bearer-токеном). Сертификаты официальные и публичные:
// https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
// https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt
const RUSSIAN_TRUSTED_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIFwjCCA6qgAwIBAgICEAAwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAxMjEwNDE1WhcNMzIwMjI3MjEwNDE1WjBwMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMSAwHgYDVQQDDBdSdXNzaWFuIFRydXN0ZWQgUm9v
dCBDQTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAMfFOZ8pUAL3+r2n
qqE0Zp52selXsKGFYoG0GM5bwz1bSFtCt+AZQMhkWQheI3poZAToYJu69pHLKS6Q
XBiwBC1cvzYmUYKMYZC7jE5YhEU2bSL0mX7NaMxMDmH2/NwuOVRj8OImVa5s1F4U
zn4Kv3PFlDBjjSjXKVY9kmjUBsXQrIHeaqmUIsPIlNWUnimXS0I0abExqkbdrXbX
YwCOXhOO2pDUx3ckmJlCMUGacUTnylyQW2VsJIyIGA8V0xzdaeUXg0VZ6ZmNUr5Y
Ber/EAOLPb8NYpsAhJe2mXjMB/J9HNsoFMBFJ0lLOT/+dQvjbdRZoOT8eqJpWnVD
U+QL/qEZnz57N88OWM3rabJkRNdU/Z7x5SFIM9FrqtN8xewsiBWBI0K6XFuOBOTD
4V08o4TzJ8+Ccq5XlCUW2L48pZNCYuBDfBh7FxkB7qDgGDiaftEkZZfApRg2E+M9
G8wkNKTPLDc4wH0FDTijhgxR3Y4PiS1HL2Zhw7bD3CbslmEGgfnnZojNkJtcLeBH
BLa52/dSwNU4WWLubaYSiAmA9IUMX1/RpfpxOxd4Ykmhz97oFbUaDJFipIggx5sX
ePAlkTdWnv+RWBxlJwMQ25oEHmRguNYf4Zr/Rxr9cS93Y+mdXIZaBEE0KS2iLRqa
OiWBki9IMQU4phqPOBAaG7A+eP8PAgMBAAGjZjBkMB0GA1UdDgQWBBTh0YHlzlpf
BKrS6badZrHF+qwshzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzAS
BgNVHRMBAf8ECDAGAQH/AgEEMA4GA1UdDwEB/wQEAwIBhjANBgkqhkiG9w0BAQsF
AAOCAgEAALIY1wkilt/urfEVM5vKzr6utOeDWCUczmWX/RX4ljpRdgF+5fAIS4vH
tmXkqpSCOVeWUrJV9QvZn6L227ZwuE15cWi8DCDal3Ue90WgAJJZMfTshN4OI8cq
W9E4EG9wglbEtMnObHlms8F3CHmrw3k6KmUkWGoa+/ENmcVl68u/cMRl1JbW2bM+
/3A+SAg2c6iPDlehczKx2oa95QW0SkPPWGuNA/CE8CpyANIhu9XFrj3RQ3EqeRcS
AQQod1RNuHpfETLU/A2gMmvn/w/sx7TB3W5BPs6rprOA37tutPq9u6FTZOcG1Oqj
C/B7yTqgI7rbyvox7DEXoX7rIiEqyNNUguTk/u3SZ4VXE2kmxdmSh3TQvybfbnXV
4JbCZVaqiZraqc7oZMnRoWrXRG3ztbnbes/9qhRGI7PqXqeKJBztxRTEVj8ONs1d
WN5szTwaPIvhkhO3CO5ErU2rVdUr89wKpNXbBODFKRtgxUT70YpmJ46VVaqdAhOZ
D9EUUn4YaeLaS8AjSF/h7UkjOibNc4qVDiPP+rkehFWM66PVnP1Msh93tc+taIfC
EYVMxjh8zNbFuoc7fzvvrFILLe7ifvEIUqSVIC/AzplM/Jxw7buXFeGP1qVCBEHq
391d/9RAfaZ12zkwFsl+IKwE/OZxW8AHa9i1p4GO0YSNuczzEm4=
-----END CERTIFICATE-----`;

const RUSSIAN_TRUSTED_SUB_CA = `-----BEGIN CERTIFICATE-----
MIIHQjCCBSqgAwIBAgICEAIwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAyMTEyNTE5WhcNMjcwMzA2MTEyNTE5WjBvMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMR8wHQYDVQQDDBZSdXNzaWFuIFRydXN0ZWQgU3Vi
IENBMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA9YPqBKOk19NFymrE
wehzrhBEgT2atLezpduB24mQ7CiOa/HVpFCDRZzdxqlh8drku408/tTmWzlNH/br
HuQhZ/miWKOf35lpKzjyBd6TPM23uAfJvEOQ2/dnKGGJbsUo1/udKSvxQwVHpVv3
S80OlluKfhWPDEXQpgyFqIzPoxIQTLZ0deirZwMVHarZ5u8HqHetRuAtmO2ZDGQn
vVOJYAjls+Hiueq7Lj7Oce7CQsTwVZeP+XQx28PAaEZ3y6sQEt6rL06ddpSdoTMp
BnCqTbxW+eWMyjkIn6t9GBtUV45yB1EkHNnj2Ex4GwCiN9T84QQjKSr+8f0psGrZ
vPbCbQAwNFJjisLixnjlGPLKa5vOmNwIh/LAyUW5DjpkCx004LPDuqPpFsKXNKpa
L2Dm6uc0x4Jo5m+gUTVORB6hOSzWnWDj2GWfomLzzyjG81DRGFBpco/O93zecsIN
3SL2Ysjpq1zdoS01CMYxie//9zWvYwzI25/OZigtnpCIrcd2j1Y6dMUFQAzAtHE+
qsXflSL8HIS+IJEFIQobLlYhHkoE3avgNx5jlu+OLYe0dF0Ykx1PGNjbwqvTX37R
Cn32NMjlotW2QcGEZhDKj+3urZizp5xdTPZitA+aEjZM/Ni71VOdiOP0igbw6asZ
2fxdozZ1TnSSYNYvNATwthNmZysCAwEAAaOCAeUwggHhMBIGA1UdEwEB/wQIMAYB
Af8CAQAwDgYDVR0PAQH/BAQDAgGGMB0GA1UdDgQWBBTR4XENCy2BTm6KSo9MI7NM
XqtpCzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzCBxwYIKwYBBQUH
AQEEgbowgbcwOwYIKwYBBQUHMAKGL2h0dHA6Ly9yb3N0ZWxlY29tLnJ1L2NkcC9y
b290Y2Ffc3NsX3JzYTIwMjIuY3J0MDsGCCsGAQUFBzAChi9odHRwOi8vY29tcGFu
eS5ydC5ydS9jZHAvcm9vdGNhX3NzbF9yc2EyMDIyLmNydDA7BggrBgEFBQcwAoYv
aHR0cDovL3JlZXN0ci1wa2kucnUvY2RwL3Jvb3RjYV9zc2xfcnNhMjAyMi5jcnQw
gbAGA1UdHwSBqDCBpTA1oDOgMYYvaHR0cDovL3Jvc3RlbGVjb20ucnUvY2RwL3Jv
b3RjYV9zc2xfcnNhMjAyMi5jcmwwNaAzoDGGL2h0dHA6Ly9jb21wYW55LnJ0LnJ1
L2NkcC9yb290Y2Ffc3NsX3JzYTIwMjIuY3JsMDWgM6Axhi9odHRwOi8vcmVlc3Ry
LXBraS5ydS9jZHAvcm9vdGNhX3NzbF9yc2EyMDIyLmNybDANBgkqhkiG9w0BAQsF
AAOCAgEARBVzZls79AdiSCpar15dA5Hr/rrT4WbrOfzlpI+xrLeRPrUG6eUWIW4v
Sui1yx3iqGLCjPcKb+HOTwoRMbI6ytP/ndp3TlYua2advYBEhSvjs+4vDZNwXr/D
anbwIWdurZmViQRBDFebpkvnIvru/RpWud/5r624Wp8voZMRtj/cm6aI9LtvBfT9
cfzhOaexI/99c14dyiuk1+6QhdwKaCRTc1mdfNQmnfWNRbfWhWBlK3h4GGE9JK33
Gk8ZS8DMrkdAh0xby4xAQ/mSWAfWrBmfzlOqGyoB1U47WTOeqNbWkkoAP2ys94+s
Jg4NTkiDVtXRF6nr6fYi0bSOvOFg0IQrMXO2Y8gyg9ARdPJwKtvWX8VPADCYMiWH
h4n8bZokIrImVKLDQKHY4jCsND2HHdJfnrdL2YJw1qFskNO4cSNmZydw0Wkgjv9k
F+KxqrDKlB8MZu2Hclph6v/CZ0fQ9YuE8/lsHZ0Qc2HyiSMnvjgK5fDc3TD4fa8F
E8gMNurM+kV8PT8LNIM+4Zs+LKEV8nqRWBaxkIVJGekkVKO8xDBOG/aN62AZKHOe
GcyIdu7yNMMRihGVZCYr8rYiJoKiOzDqOkPkLOPdhtVlgnhowzHDxMHND/E2WA5p
ZHuNM/m0TXt2wTTPL7JH2YC0gPz/BvvSzjksgzU5rLbRyUKQkgU=
-----END CERTIFICATE-----`;

// Дополняем системные корневые сертификаты российскими, а не заменяем —
// обычные (не .tbank.ru) HTTPS-запросы через этот dispatcher продолжают
// проверяться штатно.
const tbankDispatcher = new Agent({
  connect: { ca: [...tls.rootCertificates, RUSSIAN_TRUSTED_ROOT_CA, RUSSIAN_TRUSTED_SUB_CA] },
});

const TBANK_BASE =
  "https://invest-public-api.tbank.ru/rest/tinkoff.public.invest.api.contract.v1.InstrumentsService";

export interface TBankDividend {
  recordDate: string; // "YYYY-MM-DD" — дата закрытия реестра
  value: number;
  currency: string;
  // Периодичность выплаты по данным T-Bank ("Annual"/"SemiAnnual"/"Quarter"/…).
  // У T-Bank НЕТ поля точного отчётного периода вида «1кв 2026» (как на
  // smart-lab) — это была бы уже наша догадка, а не факт из API. Показываем
  // честно то, что есть: periodLabel — переведённая regularity, либо null,
  // если API её не отдал (напр. MOEX ISS фолбэк, где такого поля нет вовсе).
  periodLabel: string | null;
}

// Переводит regularity T-Bank в читаемую подпись. Значения — по фактической
// выборке всех живых ответов API по всем 185 дивидендным акциям TQBR:
// "Annual", "Semi-Anl", "Quarter", "Irreg", "" (проверено вживую, не
// документация). Неизвестное значение показываем как есть — лучше сырой
// текст, чем скрыть данные.
export function translateRegularity(regularity: string | undefined): string | null {
  if (!regularity) return null;
  const map: Record<string, string> = {
    Annual: "Ежегодно",
    "Semi-Anl": "Раз в полгода",
    Quarter: "Ежеквартально",
    Irreg: "Нерегулярно",
  };
  return map[regularity] ?? regularity;
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
      const res = await undiciFetch(`${TBANK_BASE}/${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(9000),
        // undici's own fetch (не патченный Next.js глобальный fetch) —
        // next.revalidate тут не поддерживается, зато dispatcher из того
        // же пакета совместим с нашим доверенным CA (см. выше).
        dispatcher: tbankDispatcher,
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
  AKRN: "cd3affd4-3b50-43fd-b008-518f54108d59",
};

// Раньше эти вызовы шли через next.revalidate обычного fetch() и
// дедуплицировались Data Cache Next.js; переключение на undici's own
// fetch (нужно для доверенного CA, см. выше) обошло этот кэш — каждый
// визит на /market/info или /api/market/events бил живой запрос к
// T-Bank для всех 38 тикеров разом. При любом единичном сетевом сбое
// (таймаут, обрыв соединения к серверу в РФ) карточка молча падает на
// устаревший MOEX ISS фолбэк — воспроизводилось непредсказуемо (иногда
// грузится, иногда нет: мигающие «Ближайшие дивиденды»). unstable_cache
// восстанавливает кэширование на уровне Data Cache Next.js вручную:
// ключ строится из аргументов (uid, диапазон дат) автоматически,
// поэтому единственный успешный запрос на тикер держится revalidate
// секунд и переживает последующие сбойные попытки T-Bank. Ошибки не
// кэшируются Next.js — следующий вызов после сбоя пробует T-Bank снова.
export const getDividendsByUid = unstable_cache(
  async (uid: string, fromIso: string, toIso: string): Promise<TBankDividend[]> => {
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
          periodLabel: translateRegularity(
            typeof row["regularity"] === "string" ? row["regularity"] : undefined,
          ),
        } satisfies TBankDividend;
      })
      .filter((d): d is TBankDividend => d !== null);
  },
  ["tbank-dividends"],
  { revalidate: 21600 },
);

// Диапазон запроса округляем до суток (UTC-полночь) — иначе Date.now() с
// точностью до миллисекунды на каждый вызов ломает ключ кэша выше: у
// unstable_cache ключ строится из сериализованных аргументов, и вечно
// «новый» fromIso/toIso значил бы, что кэш никогда не попадает (каждый
// запрос уникален) и защиты от сбоя T-Bank так и не появляется.
export function dividendDateRange(
  pastDays: number,
  futureDays: number,
): { fromIso: string; toIso: string } {
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  return {
    fromIso: new Date(todayUtc.getTime() - pastDays * 86400000).toISOString(),
    toIso: new Date(todayUtc.getTime() + futureDays * 86400000).toISOString(),
  };
}

// Резолвит T-Bank instrument_uid по тикеру на площадке TQBR (MOEX) — для
// инструментов вне TICKER_TO_TBANK_UID (карточка в /market/info ищет
// произвольную бумагу, а не только фиксированный список SECTOR_GROUPS).
// Кэшируем дольше (сутки) — маппинг тикер -> uid практически не меняется.
export const findTqbrInstrumentUid = unstable_cache(
  async (ticker: string): Promise<string | null> => {
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
  },
  ["tbank-find-uid"],
  { revalidate: 86400 },
);

export interface TBankShareInfo {
  ticker: string;
  uid: string;
  name: string;
}

// Полная вселенная дивидендных акций TQBR (площадка MOEX) — не вручную
// отобранные 38 бумаг из SECTOR_GROUPS, а ВСЕ акции, которые T-Bank помечает
// флагом divYieldFlag (реально платят/платили дивиденды). Один bulk-запрос
// Shares() отдаёт весь список инструментов с их UID разом — резолвить
// каждый тикер отдельным FindInstrument не нужно. ~185 из ~255 TQBR-акций
// на момент проверки. Кэшируем сутки — состав почти не меняется.
export const getAllDividendPayingShares = unstable_cache(
  async (): Promise<TBankShareInfo[]> => {
    const json = (await tbankFetch("Shares", {
      instrumentStatus: "INSTRUMENT_STATUS_BASE",
    })) as { instruments?: unknown[] };

    const rows = Array.isArray(json.instruments) ? json.instruments : [];
    return rows
      .map((r) => {
        const row = r as Record<string, unknown>;
        if (row["classCode"] !== "TQBR" || row["divYieldFlag"] !== true) return null;
        const ticker = typeof row["ticker"] === "string" ? row["ticker"] : "";
        const uid = typeof row["uid"] === "string" ? row["uid"] : "";
        if (!ticker || !uid) return null;
        return { ticker, uid, name: typeof row["name"] === "string" ? row["name"] : ticker };
      })
      .filter((s): s is TBankShareInfo => s !== null);
  },
  ["tbank-all-dividend-shares"],
  { revalidate: 86400 },
);
