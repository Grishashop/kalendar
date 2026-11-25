import test from "node:test";
import assert from "node:assert/strict";
import type { MarketResponse } from "../app/api/market/route";
import { restoreMissing } from "../lib/moex/snapshot.ts";

function snapshot(day: string, imoex: number[], rtsi: number[]): MarketResponse {
  return { calendarDay: day, indices: [], stocks: [], commodities: [], currencies: [],
    sectorStocks: [], topStocksByVolume: [], topFuturesByVolume: [], sparklines: {imoex,rtsi},
    cbrDate: null, moexTime: null, alorUsed: false };
}

test("after midnight each index switches sessions only when its new line is ready", () => {
  const yesterday = snapshot("2026-11-25", [100,102], [50,51]);
  const today = snapshot("2026-11-26", [103], [51,52]);
  restoreMissing(today, yesterday);
  assert.deepEqual(today.sparklines, {imoex:[100,102],rtsi:[51,52]});
  assert.equal(today.sparkDays?.imoex, "2026-11-25");
});
