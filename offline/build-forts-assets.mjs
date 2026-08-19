// Генератор встроенного справочника базовых активов FORTS.
//
// Нужен офлайн-сборке, где MOEX ISS недоступен, и странице сайта на случай, когда
// ISS не ответил: без справочника проверка поставочности не выполняется вовсе.
//
// Запуск: npm run build:forts-assets
//
// Правило поставочности — то же, что в lib/karman/contracts.ts: у поставочного
// контракта исполнение на следующий день после окончания обращения, у расчётного
// в тот же день. Согласовано на всех контрактах биржи: ни одного базового актива
// с противоречивым признаком.

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(resolve(here, ".."), "lib", "karman", "forts-assets.ts");

const URL_FORTS =
  "https://iss.moex.com/iss/engines/futures/markets/forts/securities.json" +
  "?iss.meta=off&iss.only=securities&securities.columns=SECID,ASSETCODE,LASTTRADEDATE,LASTDELDATE";

/** Код серии: два знака префикса, буква месяца, цифра года. */
const SERIES = /^([A-Za-z0-9]{2})([FGHJKMNQUVXZ])(\d)$/;

const response = await fetch(URL_FORTS);
if (!response.ok) throw new Error(`ISS ответил ${response.status}`);
const json = await response.json();
const columns = json.securities.columns;
const at = (name) => {
  const index = columns.indexOf(name);
  if (index === -1) throw new Error(`ISS не отдал колонку ${name}`);
  return index;
};

const rows = json.securities.data.map((row) => ({
  secid: row[at("SECID")],
  asset: row[at("ASSETCODE")],
  lastTradeDate: row[at("LASTTRADEDATE")],
  deliveryDate: row[at("LASTDELDATE")],
}));

const table = new Map();
const conflicts = [];
let skipped = 0;

for (const row of rows) {
  const match = SERIES.exec(row.secid);
  if (!match) {
    // Бессрочные контракты (USDRUBF, IMOEXF и подобные) серий не имеют.
    // Поставочных среди них нет — проверено при генерации.
    if (row.deliveryDate !== row.lastTradeDate) {
      throw new Error(`Поставочный контракт вне формы серии: ${row.secid}`);
    }
    skipped += 1;
    continue;
  }
  const prefix = match[1];
  const deliverable = row.deliveryDate !== row.lastTradeDate;
  const known = table.get(prefix);
  if (known && (known.asset !== row.asset || known.deliverable !== deliverable)) {
    conflicts.push(`${prefix}: ${known.asset}/${known.deliverable} против ${row.asset}/${deliverable}`);
    continue;
  }
  table.set(prefix, { asset: row.asset, deliverable });
}

if (conflicts.length > 0) {
  throw new Error(`Префикс с противоречивым признаком:\n${conflicts.join("\n")}`);
}

// Серии поставочных контрактов с настоящей датой окончания обращения. Правило
// «третий четверг месяца поставки» держится на 152 из 153 контрактов, но сахар
// (SUGR) из него выпадает, а он поставочный — значит правило с исключением, и
// строить на нём проверку «ближайшая ли серия» нельзя. Вкладываем факты.
const series = rows
  .filter((row) => {
    const match = SERIES.exec(row.secid);
    return match !== null && table.get(match[1])?.deliverable === true;
  })
  .map((row) => [row.secid, row.lastTradeDate])
  .sort(([a], [b]) => a.localeCompare(b));

const sorted = [...table].sort(([a], [b]) => a.localeCompare(b));
const deliverableCount = sorted.filter(([, v]) => v.deliverable).length;
const today = new Date().toISOString().slice(0, 10);
const horizon = series.reduce((max, [, date]) => (date > max ? date : max), "");

const key = (name) => (/^[A-Za-z][A-Za-z0-9]*$/.test(name) ? name : `"${name}"`);
const assetsBody = sorted
  .map(([prefix, v]) => `  ${key(prefix)}: ${v.deliverable ? "1" : "0"}, // ${v.asset}`)
  .join("\n");
const seriesBody = series.map(([secid, date]) => `  ${key(secid)}: "${date}",`).join("\n");

const file = `// СГЕНЕРИРОВАННЫЙ ФАЙЛ — правки затрутся. Пересобрать: npm run build:forts-assets
//
// Встроенный справочник FORTS: нужен там, где справочник MOEX ISS недоступен —
// в автономной сборке и на сайте, когда ISS не ответил.
//
// Снят ${today} с https://iss.moex.com: ${sorted.length} базовых активов
// (поставочных ${deliverableCount}) и ${series.length} серий поставочных контрактов
// с настоящими датами окончания обращения. Последняя известная серия обращается
// до ${horizon}; дальше проверка «ближайшая ли серия» бессильна и говорит об этом
// прямо, вместо того чтобы врать.
//
// Бессрочные контракты без серии (${skipped} шт., USDRUBF и подобные) в справочник
// не входят: поставочных среди них не бывает.

/** Дата снятия справочника: показывается в интерфейсе, чтобы возраст был виден. */
export const FORTS_ASSETS_DATE = "${today}";

/** Последняя серия, которую знает справочник: за ней проверка бессильна. */
export const FORTS_SERIES_HORIZON = "${horizon}";

/** Префикс кода серии → 1 поставочный, 0 расчётный. */
export const FORTS_ASSETS: Readonly<Record<string, 0 | 1>> = {
${assetsBody}
};

/** Серия поставочного контракта → последний день обращения, «ГГГГ-ММ-ДД». */
export const FORTS_SERIES: Readonly<Record<string, string>> = {
${seriesBody}
};
`;

writeFileSync(out, file, "utf8");
console.log(
  `Готово: lib/karman/forts-assets.ts — ${sorted.length} активов, ` +
    `поставочных ${deliverableCount}, серий ${series.length}, горизонт ${horizon}`,
);
