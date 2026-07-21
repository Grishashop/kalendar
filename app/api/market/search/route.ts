import { NextResponse } from "next/server";
import { fetchJson, parseIssTable } from "@/lib/moex/iss";

// Поиск инструмента по тикеру/ISIN/названию через MOEX ISS —
// источник данных для поля поиска в /market/info.

export interface SearchResult {
  secid: string;
  shortname: string;
  name: string;
  isin: string | null;
  isTraded: boolean;
  group: string; // сырой ISS group, метки — на клиенте
}

export interface SearchResponse {
  results: SearchResult[];
}

// Группы, в которых с наибольшей вероятностью ищут ликвидный инструмент,
// идут первыми среди результатов с одинаковым статусом торгуемости.
const GROUP_PRIORITY = [
  "stock_shares",
  "stock_bonds",
  "futures_forts",
  "futures_options",
  "stock_index",
  "currency_selt",
  "stock_etf",
  "stock_ppif",
  "stock_dr",
];

// Срочный рынок (FORTS) у части акций использует код базового актива,
// отличный от тикера самой акции — полнотекстовый поиск ISS их не связывает
// (шортнейм фьючерса/опциона — "SBRF-9.26", а не "Сбербанк"/"SBER"), поэтому
// запрос "сбер" не находил фьючерсы и опционы на Сбербанк. Список сверен
// вживую с https://iss.moex.com/iss/engines/futures/markets/forts/securities.json
// (у большинства акций FORTS-код совпадает с тикером — алиас нужен только
// для расхождений). Полюс/Северсталь/Новатэк на FORTS торгуются только под
// "M"-вариантом кода (PLZLM/CHMFM/NOTKM), отдельного "PLZL"/"CHMF"/"NOTK" нет.
const FORTS_ASSET_ALIAS: Record<string, string> = {
  SBER: "SBRF",
  GAZP: "GAZR",
  NVTK: "NOTKM",
  SNGS: "SNGP",
  SNGSP: "SNGR",
  TRNFP: "TRNF",
  PLZL: "PLZLM",
  CHMF: "CHMFM",
  MTSS: "MTSI",
};

async function searchIss(q: string): Promise<SearchResult[]> {
  const url =
    "https://iss.moex.com/iss/securities.json?q=" +
    encodeURIComponent(q) +
    "&iss.meta=off&limit=50&securities.columns=secid,shortname,name,isin,is_traded,type,group,primary_boardid";
  const json = await fetchJson(url, 2, 9000, 300);
  return parseIssTable(json, "securities").map((r) => ({
    secid: String(r["secid"] ?? ""),
    shortname: String(r["shortname"] ?? ""),
    name: String(r["name"] ?? ""),
    isin: typeof r["isin"] === "string" && r["isin"] ? r["isin"] : null,
    isTraded: r["is_traded"] === 1,
    group: typeof r["group"] === "string" ? r["group"] : "",
  }));
}

function sortResults(results: SearchResult[]): void {
  results.sort((a, b) => {
    if (a.isTraded !== b.isTraded) return a.isTraded ? -1 : 1;
    const ia = GROUP_PRIORITY.indexOf(a.group);
    const ib = GROUP_PRIORITY.indexOf(b.group);
    const pa = ia === -1 ? GROUP_PRIORITY.length : ia;
    const pb = ib === -1 ? GROUP_PRIORITY.length : ib;
    return pa - pb;
  });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] } satisfies SearchResponse);
  }

  let results: SearchResult[];
  try {
    results = await searchIss(q);
  } catch {
    return NextResponse.json(
      { error: "Не удалось получить данные" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Если среди найденных акций есть FORTS-алиас (см. FORTS_ASSET_ALIAS) —
  // догружаем фьючерсы/опционы отдельным запросом по коду базового актива,
  // иначе они не всплывут по тикеру/названию акции вообще.
  const assetCodes = new Set(
    results
      .filter((r) => r.group === "stock_shares")
      .map((r) => FORTS_ASSET_ALIAS[r.secid])
      .filter((code): code is string => Boolean(code)),
  );

  if (assetCodes.size > 0) {
    const known = new Set(results.map((r) => r.secid));
    const settled = await Promise.allSettled([...assetCodes].map((code) => searchIss(code)));
    const aliasResults: SearchResult[] = [];
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      for (const r of s.value) {
        if (
          (r.group === "futures_forts" || r.group === "futures_options") &&
          !known.has(r.secid)
        ) {
          known.add(r.secid);
          aliasResults.push(r);
        }
      }
    }
    sortResults(aliasResults);
    // Общий кап — 30, но алиас-результаты не должны вытесняться прямыми
    // совпадениями (акции/облигации по тому же запросу их обычно и так
    // выбирают под ноль слотов).
    const reserved = Math.min(aliasResults.length, 10);
    sortResults(results);
    return NextResponse.json({
      results: [...results.slice(0, 30 - reserved), ...aliasResults.slice(0, reserved)],
    } satisfies SearchResponse);
  }

  sortResults(results);
  return NextResponse.json({
    results: results.slice(0, 30),
  } satisfies SearchResponse);
}
