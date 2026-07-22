import { NextResponse } from "next/server";
import { fetchJson, lastOrNull, num, parseIssTable } from "@/lib/moex/iss";
import { TICKER_TO_TBANK_UID, findTqbrInstrumentUid, getDividendsByUid } from "@/lib/tbank/invest";

// Карточка-«паспорт» инструмента: спецификация контракта, ГО и комиссии
// (FORTS-фьючерсы/опционы), купон/доходность/дюрация (облигации), живая
// котировка и дивиденды (акции). Источник — MOEX ISS, тот же паттерн
// запросов, что и в /api/market.

export const maxDuration = 15;

export interface InfoQuote {
  last: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  updatetime: string | null;
}

export interface SpecRow {
  label: string;
  value: number | string | null;
  unit?: string;
}

export interface DividendRow {
  date: string;
  value: number;
  currency: string;
}

export interface InfoResponse {
  secid: string;
  name: string;
  typeName: string | null;
  group: string | null;
  board: { engine: string; market: string; boardid: string } | null;
  quote: InfoQuote | null;
  spec: SpecRow[] | null;
  passport: { title: string; value: string }[];
  dividends: DividendRow[] | null;
}

// Цена/изменение фьючерса: последняя сделка, иначе расчётная цена (в
// выходные/до старта сессии сделок ещё не было). Дублирует одноимённые
// хелперы в app/api/market/route.ts — сознательно не импортируется оттуда,
// это внутренняя деталь конкретно этого роута.
function futuresPrice(m: Record<string, unknown>): number | null {
  return lastOrNull(m["LAST"]) ?? lastOrNull(m["SETTLEPRICE"]);
}
function futuresChange(m: Record<string, unknown>): number | null {
  return num(m["LASTTOPREVPRICE"]) ?? num(m["SETTLETOPREVSETTLEPRC"]);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

// Строки спецификации, тип-специфичные по ISS-группе инструмента.
// secRow — securities[0] котировочного запроса, mdRow — marketdata[0].
function buildSpec(
  group: string | null,
  secRow: Record<string, unknown> | undefined,
  mdRow: Record<string, unknown> | undefined,
): SpecRow[] | null {
  if (!secRow) return null;
  const rows: SpecRow[] = [];
  const push = (label: string, value: number | string | null, unit?: string) => {
    if (value === null || value === undefined || value === "") return;
    rows.push({ label, value, unit });
  };

  switch (group) {
    case "futures_forts":
      push("Лот", num(secRow["LOTVOLUME"]), "ед. БА");
      push("Шаг цены", num(secRow["MINSTEP"]));
      push("Стоимость шага", num(secRow["STEPPRICE"]), "₽");
      push("ГО", num(secRow["INITIALMARGIN"]), "₽");
      push("Верхний лимит", num(secRow["HIGHLIMIT"]));
      push("Нижний лимит", num(secRow["LOWLIMIT"]));
      push("Последний торг. день", str(secRow["LASTTRADEDATE"]));
      push("Экспирация", str(secRow["LASTDELDATE"]));
      push("Сбор бирж.", num(secRow["BUYSELLFEE"]), "₽");
      push("Сбор скальп.", num(secRow["SCALPERFEE"]), "₽");
      push("Сбор за исполнение", num(secRow["EXERCISEFEE"]), "₽");
      push("Расч. цена пред. дня", num(secRow["PREVSETTLEPRICE"]));
      if (mdRow) {
        push("Расчётная цена", num(mdRow["SETTLEPRICE"]));
        push("Открытые позиции", num(mdRow["OPENPOSITION"]), "контр.");
        push("Объём", num(mdRow["VOLTODAY"]), "контр.");
      }
      break;
    case "futures_options":
      push("Страйк", num(secRow["STRIKE"]));
      push("Тип", str(secRow["OPTIONTYPE"]));
      push("Базовый актив", str(secRow["UNDERLYINGASSET"]));
      push("ГО покупка", num(secRow["IMBUY"]), "₽");
      push("ГО непокрытая", num(secRow["IMNP"]), "₽");
      push("Шаг премии", num(secRow["MINSTEP"]));
      push("Стоимость шага", num(secRow["STEPPRICE"]));
      push("Последний торг. день", str(secRow["LASTTRADEDATE"]));
      push("Экспирация", str(secRow["LASTDELDATE"]));
      break;
    case "stock_bonds":
      push("Купон", num(secRow["COUPONVALUE"]), "₽");
      push("Ставка купона", num(secRow["COUPONPERCENT"]), "%");
      push("Период купона", num(secRow["COUPONPERIOD"]), "дн.");
      push("След. купон", str(secRow["NEXTCOUPON"]));
      push("НКД", num(secRow["ACCRUEDINT"]), "₽");
      push("Погашение", str(secRow["MATDATE"]));
      push("Оферта", str(secRow["OFFERDATE"]));
      push("Цена оферты", num(secRow["BUYBACKPRICE"]));
      push("Номинал лота", num(secRow["LOTVALUE"]), "₽");
      push("Доходность пред. дня", num(secRow["YIELDATPREVWAPRICE"]), "%");
      if (mdRow) {
        push("Доходность", num(mdRow["YIELD"]), "%");
        push("Дюрация", num(mdRow["DURATION"]), "дн.");
      }
      break;
    default:
      return null;
  }

  return rows.length > 0 ? rows : null;
}

export async function GET(request: Request) {
  const secid = new URL(request.url).searchParams.get("secid")?.trim();
  if (!secid) {
    return NextResponse.json(
      { error: "Не указан secid" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // --- Паспорт (описание + список бордов) ---
  let passportJson: unknown;
  try {
    passportJson = await fetchJson(
      "https://iss.moex.com/iss/securities/" +
        encodeURIComponent(secid) +
        ".json?iss.meta=off",
      2,
      9000,
      3600,
    );
  } catch {
    return NextResponse.json(
      { error: "Не удалось получить данные" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const descRows = parseIssTable(passportJson, "description");
  const descMap = new Map<string, Record<string, unknown>>();
  descRows.forEach((r) => {
    if (typeof r["name"] === "string") descMap.set(r["name"], r);
  });

  const passport = descRows
    .filter((r) => r["is_hidden"] === 0)
    .sort((a, b) => (num(a["sort_order"]) ?? 0) - (num(b["sort_order"]) ?? 0))
    .map((r) => ({ title: String(r["title"] ?? ""), value: String(r["value"] ?? "") }));

  const group = str(descMap.get("GROUP")?.["value"]);
  const typeName = str(descMap.get("TYPENAME")?.["value"]);
  const name =
    str(descMap.get("SHORTNAME")?.["value"]) ?? str(descMap.get("NAME")?.["value"]) ?? secid;

  const boardRows = parseIssTable(passportJson, "boards");
  const boardRow =
    boardRows.find((r) => r["is_primary"] === 1) ??
    boardRows.find((r) => r["is_traded"] === 1) ??
    boardRows[0];

  let board: InfoResponse["board"] = null;
  let quote: InfoResponse["quote"] = null;
  let spec: InfoResponse["spec"] = null;

  if (boardRow) {
    const engine = String(boardRow["engine"] ?? "");
    const market = String(boardRow["market"] ?? "");
    const boardid = String(boardRow["boardid"] ?? "");
    board = { engine, market, boardid };

    try {
      const quoteJson = await fetchJson(
        `https://iss.moex.com/iss/engines/${engine}/markets/${market}/boards/${boardid}/securities/${encodeURIComponent(secid)}.json?iss.meta=off&iss.only=securities,marketdata`,
        2,
        9000,
        30,
      );
      const secRow = parseIssTable(quoteJson, "securities")[0] as
        | Record<string, unknown>
        | undefined;
      const mdRow = parseIssTable(quoteJson, "marketdata")[0] as
        | Record<string, unknown>
        | undefined;

      if (mdRow) {
        const isForts = group === "futures_forts";
        quote = {
          last: isForts ? futuresPrice(mdRow) : lastOrNull(mdRow["LAST"]),
          changePct: isForts ? futuresChange(mdRow) : num(mdRow["LASTTOPREVPRICE"]),
          open: lastOrNull(mdRow["OPEN"]),
          high: lastOrNull(mdRow["HIGH"]),
          low: lastOrNull(mdRow["LOW"]),
          updatetime: str(mdRow["UPDATETIME"]),
        };
      }

      spec = buildSpec(group, secRow, mdRow);
    } catch {
      // Карточка живёт на одном паспорте — котировка/спецификация опциональны.
      quote = null;
      spec = null;
    }
  }

  // --- Дивиденды (только акции) --- T-Bank Invest API даёт заметно более
  // свежие данные, чем MOEX ISS (см. lib/tbank/invest.ts) — пробуем сначала
  // его, при неудаче/отсутствии токена падаем на MOEX ISS для той же бумаги.
  let dividends: InfoResponse["dividends"] = null;
  if (group === "stock_shares") {
    try {
      const uid = TICKER_TO_TBANK_UID[secid] ?? (await findTqbrInstrumentUid(secid));
      if (!uid) throw new Error("Тикер не найден в T-Bank Invest API");
      const now = Date.now();
      const rows = await getDividendsByUid(
        uid,
        new Date(now - 3650 * 86400000).toISOString(),
        new Date(now + 400 * 86400000).toISOString(),
      );
      dividends = rows
        .map((r) => ({ date: r.recordDate, value: r.value, currency: r.currency }))
        .filter((d) => d.date)
        .sort((a, b) => b.date.localeCompare(a.date));
    } catch {
      try {
        const divJson = await fetchJson(
          "https://iss.moex.com/iss/securities/" +
            encodeURIComponent(secid) +
            "/dividends.json?iss.meta=off",
          2,
          9000,
          21600,
        );
        const rows = parseIssTable(divJson, "dividends");
        dividends = rows
          .map((r) => ({
            date: String(r["registryclosedate"] ?? ""),
            value: num(r["value"]) ?? 0,
            currency: String(r["currencyid"] ?? ""),
          }))
          .filter((d) => d.date)
          .sort((a, b) => b.date.localeCompare(a.date));
      } catch {
        dividends = null;
      }
    }
  }

  const body: InfoResponse = {
    secid,
    name,
    typeName,
    group,
    board,
    quote,
    spec,
    passport,
    dividends,
  };

  return NextResponse.json(body);
}
