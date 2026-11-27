import test from "node:test";
import assert from "node:assert/strict";
import type { MarketResponse } from "../app/api/market/route";
import { preferIndexCandle } from "../lib/moex/calendar.ts";
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

test("an index summary without a quote timestamp cannot replace the current session candle", () => {
  const candle = "2026-11-27T06:50:00.000Z";
  assert.equal(preferIndexCandle(candle), true);
  assert.equal(preferIndexCandle(candle, "2026-11-26T20:49:59.000Z"), true);
  assert.equal(preferIndexCandle(candle, "2026-11-27T06:58:00.000Z"), false);
  assert.equal(preferIndexCandle(candle, candle), false);
  assert.equal(preferIndexCandle(undefined), false);
});
