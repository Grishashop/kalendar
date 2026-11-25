import test from "node:test";
import assert from "node:assert/strict";
import { previousMoscowDay, lastCandleBefore } from "../lib/moex/calendar.ts";

test("midnight Moscow uses exactly the preceding calendar day", () => {
  const { start, end, day } = previousMoscowDay("2026-01-01");
  assert.equal(day, "2025-12-31");
  assert.equal(new Date(end).toISOString(), "2025-12-31T21:00:00.000Z");
  assert.equal(lastCandleBefore([{time:end,close:130}, {time:end-1,close:110},
    {time:start,close:100}, {time:start-1,close:90}], end)?.close, 110);
  assert.equal(lastCandleBefore([{time:end,close:90}], end), null);
});

test("a weekend without trades uses the last Friday candle", () => {
  const monday = previousMoscowDay("2026-11-23");
  const friday = {time:Date.parse("2026-11-20T23:50:00+03:00"), close:99};
  assert.equal(lastCandleBefore([friday], monday.end)?.close, 99);
});


test("uses a weekend session when it is more recent than Friday", () => {
  const { end } = previousMoscowDay("2026-11-23");
  assert.equal(lastCandleBefore([
    {time: end - 3 * 86400000, close: 90},
    {time: end - 12 * 3600000, close: 100},
    {time: end + 3600000, close: 120},
  ], end)?.close, 100);
});
