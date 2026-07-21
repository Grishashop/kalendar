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

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] } satisfies SearchResponse);
  }

  const url =
    "https://iss.moex.com/iss/securities.json?q=" +
    encodeURIComponent(q) +
    "&iss.meta=off&limit=50&securities.columns=secid,shortname,name,isin,is_traded,type,group,primary_boardid";

  let json: unknown;
  try {
    json = await fetchJson(url, 2, 9000, 300);
  } catch {
    return NextResponse.json(
      { error: "Не удалось получить данные" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rows = parseIssTable(json, "securities");
  const results: SearchResult[] = rows.map((r) => ({
    secid: String(r["secid"] ?? ""),
    shortname: String(r["shortname"] ?? ""),
    name: String(r["name"] ?? ""),
    isin: typeof r["isin"] === "string" && r["isin"] ? r["isin"] : null,
    isTraded: r["is_traded"] === 1,
    group: typeof r["group"] === "string" ? r["group"] : "",
  }));

  results.sort((a, b) => {
    if (a.isTraded !== b.isTraded) return a.isTraded ? -1 : 1;
    const ia = GROUP_PRIORITY.indexOf(a.group);
    const ib = GROUP_PRIORITY.indexOf(b.group);
    const pa = ia === -1 ? GROUP_PRIORITY.length : ia;
    const pb = ib === -1 ? GROUP_PRIORITY.length : ib;
    return pa - pb;
  });

  return NextResponse.json({
    results: results.slice(0, 30),
  } satisfies SearchResponse);
}
