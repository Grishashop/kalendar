/**
 * Шаблоны генерации транзакций.
 *
 * Эталонный набор живёт здесь, в git; редактор в интерфейсе хранит отклонения
 * в localStorage и умеет сбрасываться к этому файлу
 * (см. docs/adr/0004-shablony-v-kode-pravki-v-localstorage.md).
 */

export type ColumnType = "number" | "text" | "date";

export interface TemplateColumn {
  /** Имя, под которым колонка видна выражениям: `[Тек. чист. поз.]`. */
  name: string;
  type: ColumnType;
  /** Необязательная проверка сверх типа — ловит перестановку однотипных колонок. */
  pattern?: string;
  /** Пустая ячейка допустима; в числовом контексте даёт 0. */
  nullable?: boolean;
  /**
   * Числовая колонка сортируется по модулю. Для знаковой позиции знак — это
   * направление сделки, а не величина: оператора интересует размер закрытия.
   */
  sortByAbs?: boolean;
}

/**
 * Роли: имена колонок или именованных выражений, по которым код находит нужные
 * величины. Объявляются один раз и служат сразу сводке, сверкам и сопоставлению
 * вставок между собой — чтобы одно и то же понятие не описывалось дважды.
 */
export interface TemplateRoles {
  /** Позиции: количество в заявке — число. */
  quantity: string;
  /** Позиции: направление заявки — текст. */
  direction: string;
  instrument: string;
  account: string;
  /** Позиции: дата погашения — для сверки со справочником биржи. */
  maturity: string;
  /** Позиции: объём активных заявок на покупку и продажу. */
  activeBuy: string;
  activeSell: string;
  /** Заявки: по этим колонкам заявка привязывается к позиции. */
  orderAccount: string;
  orderInstrument: string;
  /** Заявки: сторона и объём — для сверки с «Акт. покупка» и «Акт. продажа». */
  orderSide: string;
  orderQuantity: string;
  /** Значение стороны, означающее покупку; всё прочее считается продажей. */
  orderBuyLabel: string;
  /** Стоп-заявки: привязка к позиции. Сверить объём не с чем. */
  stopAccount: string;
  stopInstrument: string;
}

/** Умолчания ценообразования; правятся в редакторе шаблона. */
export interface TemplatePricing {
  /** Спред на проскальзывание, проценты от котировки. */
  spreadPercent: number;
  /** Предельный возраст стакана в секундах; старше — заявка уходит рыночной. */
  freshnessSec: number;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Колонки основной вставки — позиций. */
  columns: TemplateColumn[];
  /** Колонки вставки активных заявок. */
  orderColumns: TemplateColumn[];
  /** Колонки вставки активных стоп-заявок. */
  stopColumns: TemplateColumn[];
  /**
   * Именованные выражения. Ссылка на них в тексте транзакции и в сводке
   * выглядит как ссылка на колонку: `[Количество]`. Нужны, чтобы правило
   * считалось в одном месте, а не копировалось по формулам.
   */
  values: Record<string, string>;
  /** Выражение; истина — строка не попадает в вывод. */
  skipWhen: string;
  /** Колонки, значения которых в корректной выборке одинаковы во всех строках. */
  warnUniform: string[];
  /** Колонки, которые в корректной выборке пусты во всех строках. */
  warnEmpty: string[];
  /** Текст транзакции на ввод заявки. */
  line: string;
  /** Текст транзакции на снятие обычной заявки; выражения над `orderColumns`. */
  cancelLine: string;
  /** Текст транзакции на снятие стоп-заявки; выражения над `stopColumns`. */
  cancelStopLine: string;
  roles: TemplateRoles;
  pricing: TemplatePricing;
}

/** Псевдоколонка: сквозной номер строки в выводе, считается после отсева. */
export const ROW_NUMBER_COLUMN = "№";

const FORTS_LINE = [
  "TRANS_ID=${[№]}",
  "CLASSCODE=SPBFUT",
  "ACTION=Ввод заявки",
  "Торговый счет=${[Торговый счет]}",
  "К/П=${[Направление]}",
  "Тип=${[Тип заявки]}",
  "Класс=SPBFUT",
  "Инструмент=${[Код инструмента]}",
  "Цена=${[Цена заявки]}",
  "Количество=${[Количество]}",
  "Условие исполнения=Поставить в очередь",
  "Комментарий=/&!62",
  "Переносить заявку=Нет",
  'Дата экспирации=${TEXT(TODAY();"ГГГГММДД")}',
  "Код внешнего пользователя=",
  "",
].join(";");

// Снятие не требует ни счёта, ни инструмента — номер заявки уникален сам по себе.
// Строки получены выгрузкой из терминала, см. docs/adr/0009.
const FORTS_CANCEL_LINE =
  "TRANS_ID=${[№]};CLASSCODE=SPBFUT;ACTION=Снятие заявки;Номер заявки=${[Номер заявки]};";

const FORTS_CANCEL_STOP_LINE =
  "TRANS_ID=${[№]};CLASSCODE=SPBFUT;ACTION=Снять стоп-заявку;" +
  "Номер Стоп-Заявки=${[Номер стоп-заявки]};";

export const BUILTIN_TEMPLATES: readonly Template[] = [
  {
    id: "forts-expiration",
    name: "Экспирация FORTS",
    description:
      "Закрытие позиций по поставочным фьючерсным контрактам. Вставьте выборку " +
      "из QUIK, отфильтрованную по дате погашения ближайшей поставочной серии.",
    columns: [
      // Счёт длиннее тикера — регулярки разводят две текстовые колонки,
      // которые типовая проверка сама по себе не различает.
      { name: "Торговый счет", type: "text", pattern: "^[A-Za-z0-9_-]{6,16}$" },
      { name: "Тек. чист. поз.", type: "number", sortByAbs: true },
      { name: "Код инструмента", type: "text", pattern: "^[A-Za-z0-9]{3,5}$" },
      { name: "Дата погашения", type: "date" },
      { name: "Акт. покупка", type: "number", nullable: true },
      { name: "Акт. продажа", type: "number", nullable: true },
    ],
    orderColumns: [
      { name: "Торговый счет", type: "text", pattern: "^[A-Za-z0-9_-]{6,16}$" },
      { name: "Код инструмента", type: "text", pattern: "^[A-Za-z0-9]{3,5}$" },
      // Только текст: номера заявок бывают девятнадцатизначными и в число
      // не помещаются — округление дало бы снятие чужой заявки (ADR-0009).
      { name: "Номер заявки", type: "text", pattern: "^\\d+$" },
      { name: "К/П", type: "text" },
      { name: "Количество", type: "number" },
    ],
    stopColumns: [
      { name: "Торговый счет", type: "text", pattern: "^[A-Za-z0-9_-]{6,16}$" },
      { name: "Код инструмента", type: "text", pattern: "^[A-Za-z0-9]{3,5}$" },
      { name: "Номер стоп-заявки", type: "text", pattern: "^\\d+$" },
      { name: "К/П", type: "text" },
      { name: "Количество", type: "number" },
    ],
    values: {
      // Закрытие позиции: длинную продаём, короткую откупаем.
      Направление: 'IF([Тек. чист. поз.]>0;"Продажа";"Покупка")',
      Количество: "ABS([Тек. чист. поз.])",
    },
    skipWhen: "[Количество] = 0",
    warnUniform: ["Дата погашения"],
    warnEmpty: [],
    line: FORTS_LINE,
    cancelLine: FORTS_CANCEL_LINE,
    cancelStopLine: FORTS_CANCEL_STOP_LINE,
    roles: {
      quantity: "Количество",
      direction: "Направление",
      instrument: "Код инструмента",
      account: "Торговый счет",
      maturity: "Дата погашения",
      activeBuy: "Акт. покупка",
      activeSell: "Акт. продажа",
      orderAccount: "Торговый счет",
      orderInstrument: "Код инструмента",
      orderSide: "К/П",
      orderQuantity: "Количество",
      orderBuyLabel: "Покупка",
      stopAccount: "Торговый счет",
      stopInstrument: "Код инструмента",
    },
    // 120 с лежит в разрыве между двумя режимами: при живой ленте стакан
    // ликвидного контракта обновляется за секунды, при задержанной возраст
    // уходит за 900 с. Порог правится здесь же, без изменения кода.
    pricing: { spreadPercent: 0.5, freshnessSec: 120 },
  },
];

// v2: форма шаблона изменилась несовместимо — добавились вставки заявок,
// строки снятия и роли. Правки под старым ключом не подхватываются намеренно:
// частично применённый старый шаблон опаснее сброшенного.
const STORAGE_KEY = "karman.templates.v2";

type StoredOverrides = Record<string, Partial<Template>>;

/** Битое или чужое содержимое ключа не должно ронять страницу — молча игнорируем. */
function readOverrides(): StoredOverrides {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredOverrides) : {};
  } catch {
    return {};
  }
}

/** Шаблоны с наложенными локальными правками. Порядок и состав задаёт код. */
export function loadTemplates(): Template[] {
  const overrides = readOverrides();
  return BUILTIN_TEMPLATES.map((builtin) => {
    const override = overrides[builtin.id];
    if (!override) return structuredClone(builtin) as Template;
    return { ...structuredClone(builtin), ...structuredClone(override), id: builtin.id };
  });
}

export function saveTemplate(template: Template): void {
  if (!BUILTIN_TEMPLATES.some((item) => item.id === template.id)) return;

  const overrides = readOverrides();
  overrides[template.id] = {
    columns: template.columns,
    orderColumns: template.orderColumns,
    stopColumns: template.stopColumns,
    values: template.values,
    roles: template.roles,
    pricing: template.pricing,
    skipWhen: template.skipWhen,
    warnUniform: template.warnUniform,
    warnEmpty: template.warnEmpty,
    line: template.line,
    cancelLine: template.cancelLine,
    cancelStopLine: template.cancelStopLine,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function resetTemplate(id: string): Template {
  const builtin = BUILTIN_TEMPLATES.find((item) => item.id === id);
  if (!builtin) throw new Error(`Неизвестный шаблон: ${id}`);

  const overrides = readOverrides();
  delete overrides[id];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  return structuredClone(builtin) as Template;
}

export function isTemplateModified(template: Template): boolean {
  const builtin = BUILTIN_TEMPLATES.find((item) => item.id === template.id);
  if (!builtin) return false;
  return (
    JSON.stringify({ ...builtin, name: null, description: null }) !==
    JSON.stringify({ ...template, name: null, description: null })
  );
}
