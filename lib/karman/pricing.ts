/**
 * Арифметика цены заявки для кармана транзакций.
 *
 * Модуль решает одну задачу: закрыть позицию по поставочному фьючерсу так,
 * чтобы заявка гарантированно исполнилась. Отсюда все решения ниже:
 *
 * - спред добавляется в агрессивную сторону — мы сознательно переплачиваем
 *   несколько шагов цены за то, что заявка не повиснет в стакане;
 * - округление к шагу цены тоже агрессивное, иначе округление в нашу пользу
 *   съело бы этот спред и вернуло заявку в исходный риск;
 * - рыночная заявка на срочном рынке подаётся с наихудшей допустимой ценой
 *   (планка дня), а не с нулём: нуль QUIK не примет;
 * - если лимитную цену построить не из чего, тип заявки деградирует в рыночную,
 *   а причина возвращается оператору текстом — молча менять тип заявки нельзя.
 *
 * Модуль чистый: без сети, без импортов и без побочных эффектов.
 */

export type OrderMode = "market" | "limit";

export interface Quote {
  bid: number | null;
  ask: number | null;
  last: number | null;
  /** Возраст котировки в секундах на момент расчёта. */
  ageSec: number | null;
}

export interface PriceInput {
  direction: "buy" | "sell";
  mode: OrderMode;
  /** Насколько процентов уступаем рынку ради исполнения. */
  spreadPercent: number;
  /** Предельный возраст котировки в секундах, при котором ей ещё верим. */
  freshnessSec: number;
  quote: Quote | null;
  minStep: number | null;
  highLimit: number | null;
  lowLimit: number | null;
}

export interface PriceResult {
  /** Фактический тип заявки после возможной деградации, а не запрошенный. */
  type: OrderMode;
  /** null — цену вычислить не из чего. */
  price: number | null;
  /** Почему заявка не лимитная или почему нет цены. */
  reason: string | null;
}

/** Цена, объём и шаг не бывают отрицательными: мусор и NaN считаем отсутствием данных. */
function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Число знаков после запятой, которые имеет смысл хранить при данном шаге цены.
 *
 * Разбираем именно десятичную запись шага, а не считаем логарифм: шаг приходит
 * с биржи как 0.0001 или 12.5, и его собственная запись — единственный честный
 * источник требуемой точности.
 */
function stepPrecision(step: number): number {
  const text = String(step);
  const exponentAt = text.indexOf("e");
  const dotAt = text.indexOf(".");

  if (exponentAt === -1) {
    return dotAt === -1 ? 0 : text.length - dotAt - 1;
  }

  // Экспоненциальная запись вида "1e-7" или "1.5e-7".
  const mantissaDigits = dotAt === -1 ? 0 : exponentAt - dotAt - 1;
  const exponent = Number(text.slice(exponentAt + 1));
  return Math.min(Math.max(mantissaDigits - exponent, 0), 20);
}

/**
 * Округление к сетке шага цены в агрессивную сторону: покупка вверх, продажа вниз.
 *
 * Деление на дробный шаг само по себе даёт двоичную погрешность (1.23455 / 0.0001
 * это 12345.499999999998), из-за которой Math.ceil прыгает на лишний шаг, а
 * умножение обратно оставляет хвост вида 1040.0000000000002. Такой хвост уходит
 * прямо в текст транзакции и ломает её на стороне QUIK, поэтому частное
 * притягиваем относительным допуском, а результат приводим к точности шага.
 */
function roundToStep(price: number, step: number, roundUp: boolean): number {
  const ratio = price / step;
  const tolerance = Math.abs(ratio) * 1e-9;
  const steps = roundUp ? Math.ceil(ratio - tolerance) : Math.floor(ratio + tolerance);
  return Number((steps * step).toFixed(stepPrecision(step)));
}

export function computePrice(input: PriceInput): PriceResult {
  const { direction, mode, quote } = input;
  const isBuy = direction === "buy";

  const minStep = positiveOrNull(input.minStep);
  const highLimit = positiveOrNull(input.highLimit);
  const lowLimit = positiveOrNull(input.lowLimit);

  // Отсутствующий спред — это нулевой спред, а не NaN на всю дальнейшую цепочку.
  const spreadPercent =
    Number.isFinite(input.spreadPercent) && input.spreadPercent > 0 ? input.spreadPercent : 0;
  const freshnessSec =
    Number.isFinite(input.freshnessSec) && input.freshnessSec > 0 ? input.freshnessSec : 0;

  const clamp = (value: number): number => {
    let result = value;
    if (highLimit !== null && result > highLimit) result = highLimit;
    if (lowLimit !== null && result < lowLimit) result = lowLimit;
    return result;
  };

  let reason: string | null = null;

  if (mode === "limit") {
    const side = quote === null ? null : positiveOrNull(isBuy ? quote.ask : quote.bid);
    // Отрицательный возраст означает, что стакан новее момента отсчёта —
    // рассинхрон часов или обновление прямо во время запроса. Это признак
    // предельно свежих данных, а не их отсутствия.
    const ageSec =
      quote === null || quote.ageSec === null || !Number.isFinite(quote.ageSec)
        ? null
        : Math.max(0, quote.ageSec);

    if (quote === null) {
      reason = "нет котировки";
    } else if (ageSec === null) {
      reason = "возраст котировки неизвестен";
    } else if (ageSec > freshnessSec) {
      reason = `котировка старше ${freshnessSec} с`;
    } else if (side === null) {
      reason = "нет стороны стакана";
    } else {
      // Спред всегда против нас: покупаем выше аска, продаём ниже бида.
      const raw = isBuy
        ? side * (1 + spreadPercent / 100)
        : side * (1 - spreadPercent / 100);
      const stepped = minStep === null ? raw : roundToStep(raw, minStep, isBuy);
      return { type: "limit", price: clamp(stepped), reason: null };
    }
  }

  // Рыночная заявка уходит с нулевой ценой: планку применит биржа. Подставлять
  // её самим значило бы зависеть от справочника в тот момент, когда позицию надо
  // закрыть любой ценой. Хуже того, до открытия сессии источники отдают полосу
  // прошедшего дня: замерено, как ISS держал у SRU6 верх 31380, когда биржевой
  // уже был 31669. Заявка по старой планке уходит за новую и отвергается,
  // а работа по экспирации приходится ровно на это утреннее окно.
  // Формат «Тип=Рыночная;Цена=0» подтверждён выгрузкой терминала (ADR-0012).
  return { type: "market", price: 0, reason };
}
