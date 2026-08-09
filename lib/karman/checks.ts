/**
 * Проверка инструмента по справочнику биржи.
 *
 * Закрывать по экспирации следует только ближайшую поставочную серию: расчётные
 * контракты исполняются деньгами сами, а следующая серия обращается ещё квартал
 * (см. docs/adr/0006-kotirovki-alor-spravochnik-iss.md).
 */

import type { ContractInfo } from "./contracts";
import { parseDate } from "./parse";

export type CheckVerdict =
  | "ok"
  | "unchecked"
  | "deliveryUnknown"
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

/**
 * `available = false` означает, что справочник не загрузился. Это не то же самое,
 * что «контракт не найден»: во втором случае строку надо исключить, в первом —
 * пропустить проверку, иначе сбой ISS остановит закрытие позиций в день поставки.
 */
export function checkContract(
  secid: string,
  contract: ContractInfo | null | undefined,
  maturity: string,
  available: boolean,
): ContractCheck {
  if (!available) return { verdict: "unchecked", message: null };

  if (!contract) {
    return {
      verdict: "unknown",
      message: `${secid}: контракта нет в справочнике FORTS — возможно, уже отторговался`,
    };
  }

  if (contract.deliverable === null) {
    // Незнание нельзя приравнивать к «расчётный»: это исключило бы строку
    // из пачки и отправило контракт на поставку.
    return {
      verdict: "deliveryUnknown",
      message: `${secid}: справочник не ответил, поставочность не проверена`,
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
