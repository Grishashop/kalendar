import assert from "node:assert/strict";
import test from "node:test";
import { mergeQuoteRows } from "../lib/moex/quote-priority.ts";

test("uses the first valid price per instrument and preserves ISS turnover", () => {
  const iss = [
    { SECID: "SBER", LAST: 100, VALTODAY: 50, LASTTOPREVPRICE: -2 },
    { SECID: "GAZP", LAST: 120 },
  ];
  const tbank = new Map([["SBER", { last: 101 }], ["GAZP", { last: 0 }]]);
  const alor = new Map([["SBER", { last: 102 }], ["GAZP", { last: 121 }]]);
  const rows = mergeQuoteRows(iss, ["SBER", "GAZP", "LKOH"], "LAST", tbank, alor);
  assert.equal(rows[0].LAST, 101);
  assert.equal(rows[0].VALTODAY, 50);
  assert.equal(rows[0].LASTTOPREVPRICE, null);
  assert.equal(rows[1].LAST, 121);
  assert.equal(rows.length, 2);
  assert.deepEqual(mergeQuoteRows(iss, ["SBER"], "LAST", new Map(), new Map()), iss);
  assert.equal(mergeQuoteRows([], ["SBER"], "LAST", tbank, alor)[0].LAST, 101);
});
