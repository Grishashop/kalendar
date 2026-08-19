/**
 * Проверка инструмента по справочнику биржи.
 *
 * Закрывать по экспирации следует только ближайшую поставочную серию: расчётные
 * контракты исполняются деньгами сами, а следующая серия обращается ещё квартал
 * (см. docs/adr/0006-kotirovki-alor-spravochnik-iss.md).
 */

import type { ContractInfo } from "./contracts";
import { parseDate } from "./parse";
import {
  FORTS_ASSETS,
  FORTS_ASSETS_DATE,
  FORTS_SERIES,
  FORTS_SERIES_HORIZON,
} from "./forts-assets";

export type CheckVerdict =
  | "ok"
  | "unchecked"
  | "unknown"
  | "notDeliverable"
  | "notNearest"
  | "maturityMismatch";

export interface ContractCheck {
  verdict: CheckVerdict;
  /** Человекочитаемая причина; null, когда проверка пройдена. */
  message: string | null;
}

const OK: ContractCheck = { verdict: "ok", message: null };

/** Буквы месяцев в кодах серий FORTS: F — январь, Z — декабрь. */
const MONTH_LETTERS = "FGHJKMNQUVXZ";

/** Код серии: два знака префикса базового актива, буква месяца, цифра года. */
const SERIES_CODE = /^([A-Za-z0-9]{2})([FGHJKMNQUVXZ])(\d)$/;

export { FORTS_ASSETS_DATE, FORTS_SERIES_HORIZON };

const iso = (day: Date) =>
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;

/**
 * Месяц серии в виде «год × 12 + месяц» — прямо из кода контракта, без справочника.
 * Цифра года последняя, поэтому берём ближайший к сегодня год, оканчивающийся на
 * неё: новые серии распознаются без пересборки справочника.
 *
 * Проверено на всех сериях биржи: обращение никогда не выходит за месяц кода
 * (у сырьевых может кончиться месяцем раньше). Значит серия с месяцем кода
 * строго до текущего отторговалась наверняка — ложной блокировки быть не может.
 */
function seriesMonths(letter: string, digit: string, today: Date): number {
  const month = MONTH_LETTERS.indexOf(letter) + 1;
  const decade = today.getFullYear() - (today.getFullYear() % 10);
  const candidate = decade + Number(digit);
  const year = candidate < today.getFullYear() ? candidate + 10 : candidate;
  return year * 12 + month;
}

/**
 * Проверка по встроенному справочнику — когда справочник биржи недоступен:
 * в автономной сборке или при сбое ISS.
 *
 * Ближайшая серия определяется по настоящим датам окончания обращения, а не по
 * правилу «третий четверг»: правило держится на 152 контрактах из 153, но сахар
 * из него выпадает, а он поставочный. Даты сравниваются как строки «ГГГГ-ММ-ДД» —
 * лексикографический порядок у такого формата совпадает с хронологическим.
 *
 * Незнакомый префикс и неизвестная серия НЕ блокируют строку: справочник снят
 * однажды и старе́ет. Блокировать поставочный контракт по незнанию значит
 * отправить позицию на поставку — ошибка дороже лишней заявки.
 */
export function checkByTable(secid: string, maturity: string, today: Date): ContractCheck {
  const match = SERIES_CODE.exec(secid);
  // Бессрочные контракты (USDRUBF и подобные) серий не имеют и не экспирируются.
  if (!match) return { verdict: "unchecked", message: null };

  const known = FORTS_ASSETS[match[1]];
  if (known === undefined) {
    return {
      verdict: "unchecked",
      message: `${secid}: базового актива нет во встроенном справочнике от ${FORTS_ASSETS_DATE}`,
    };
  }

  if (known === 0) {
    return {
      verdict: "notDeliverable",
      message: `${secid}: расчётный контракт по встроенному справочнику от ${FORTS_ASSETS_DATE}`,
    };
  }

  // Отторговавшихся серий в снимке нет — он содержит только обращающиеся. Поэтому
  // сначала спрашиваем сам код контракта: он один ловит вставку прошлой серии,
  // сколько бы справочник ни старел.
  const nowMonths = today.getFullYear() * 12 + (today.getMonth() + 1);
  if (seriesMonths(match[2], match[3], today) < nowMonths) {
    return {
      verdict: "unknown",
      message: `${secid}: серия ${match[2]}${match[3]} уже отторговалась — обращение кончилось в месяце кода`,
    };
  }

  const day = iso(today);
  const lastTradeDate = FORTS_SERIES[secid];
  if (lastTradeDate === undefined) {
    return {
      verdict: "unchecked",
      message:
        `${secid}: серии нет во встроенном справочнике от ${FORTS_ASSETS_DATE} ` +
        `(он знает серии до ${FORTS_SERIES_HORIZON}) — проверьте серию сами`,
    };
  }

  if (lastTradeDate < day) {
    return {
      verdict: "unknown",
      message: `${secid}: серия отторговалась ${lastTradeDate}`,
    };
  }

  // Ближайшая обращающаяся серия того же базового актива.
  let nearest: string | null = null;
  let nearestDate = "";
  for (const [code, date] of Object.entries(FORTS_SERIES)) {
    if (!code.startsWith(match[1]) || date < day) continue;
    if (nearest === null || date < nearestDate) {
      nearest = code;
      nearestDate = date;
    }
  }

  if (nearest !== null && nearest !== secid) {
    return {
      verdict: "notNearest",
      message: `${secid}: не ближайшая серия, ближайшая — ${nearest} (обращение до ${nearestDate})`,
    };
  }

  // Если справочник исчерпан по горизонту, «ближайшая» могла остаться неизвестной.
  if (nearest === null && FORTS_SERIES_HORIZON < day) {
    return {
      verdict: "unchecked",
      message: `встроенный справочник знает серии только до ${FORTS_SERIES_HORIZON} — пересоберите его`,
    };
  }

  const pasted = parseDate(maturity);
  if (pasted && iso(pasted) !== lastTradeDate) {
    return {
      verdict: "maturityMismatch",
      message:
        `${secid}: дата погашения ${maturity} не сходится со справочником ` +
        `(обращение до ${lastTradeDate})`,
    };
  }

  return OK;
}

/**
 * `available = false` означает, что справочник биржи не загрузился. Тогда
 * проверяем по встроенному: раньше строка уходила без проверки вовсе, и в
 * автономной сборке поставочность не проверялась никак.
 */
export function checkContract(
  secid: string,
  contract: ContractInfo | null | undefined,
  maturity: string,
  available: boolean,
  today: Date = new Date(),
): ContractCheck {
  if (!available) return checkByTable(secid, maturity, today);

  if (!contract) {
    return {
      verdict: "unknown",
      message: `${secid}: контракта нет в справочнике FORTS — возможно, уже отторговался`,
    };
  }

  if (!contract.deliverable) {
    return {
      verdict: "notDeliverable",
      message: `${secid}: расчётный контракт, закрывать по экспирации не нужно`,
    };
  }

  if (!contract.isNearest) {
    const nearest = contract.nearestSecid ? `, ближайшая — ${contract.nearestSecid}` : "";
    return {
      verdict: "notNearest",
      message: `${secid}: не ближайшая серия${nearest}`,
    };
  }

  // Колонка QUIK «Дата погашения» — это последний день обращения (LASTTRADEDATE),
  // а не дата исполнения: у поставочных фьючерсов на акции они отличаются на день
  // (17.09 против 18.09), у расчётных совпадают. Проверено на живой выдаче ISS.
  // Принимаем обе даты: смысл проверки — поймать не ту серию, где обе разойдутся
  // на месяцы, а не спорить с терминалом о терминологии.
  const pasted = parseDate(maturity);
  if (pasted) {
    const iso = `${pasted.getFullYear()}-${String(pasted.getMonth() + 1).padStart(2, "0")}-${String(
      pasted.getDate(),
    ).padStart(2, "0")}`;
    if (iso !== contract.lastTradeDate && iso !== contract.deliveryDate) {
      return {
        verdict: "maturityMismatch",
        message:
          `${secid}: дата погашения ${iso} не совпадает со справочником ` +
          `(обращение до ${contract.lastTradeDate}, исполнение ${contract.deliveryDate})`,
      };
    }
  }

  return OK;
}
