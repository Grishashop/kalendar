import test from "node:test";
import assert from "node:assert/strict";
import { previousMoscowDay, lastCloseInDay } from "../lib/moex/calendar.ts";

test("midnight Moscow uses exactly the preceding calendar day", () => {
  const { start, end, day } = previousMoscowDay("2026-01-01");
  assert.equal(day, "2025-12-31");
  assert.equal(new Date(end).toISOString(), "2025-12-31T21:00:00.000Z");
  assert.equal(lastCloseInDay([{time:end,close:130}, {time:end-1,close:110},
    {time:start,close:100}, {time:start-1,close:90}], start, end), 110);
  assert.equal(lastCloseInDay([{time:start-1,close:90}], start, end), null);
});

test("a Sunday without trades cannot silently use Friday's close", () => {
  const monday = previousMoscowDay("2026-11-23");
  const friday = {time:Date.parse("2026-11-20T23:50:00+03:00"), close:99};
  assert.equal(lastCloseInDay([friday], monday.start, monday.end), null);
});
