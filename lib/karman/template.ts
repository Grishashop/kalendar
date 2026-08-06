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

/** Роли для сводки: имена колонок или именованных выражений. */
export interface TemplateStats {
  /** Количество в заявке — число. */
  quantity: string;
  /** Направление заявки — текст. */
  direction: string;
  instrument: string;
  account: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  columns: TemplateColumn[];
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
  /** Текст транзакции с выражениями `${...}`. */
  line: string;
  stats: TemplateStats;
}

/** Псевдоколонка: сквозной номер строки в выводе, считается после отсева. */
export const ROW_NUMBER_COLUMN = "№";

const FORTS_LINE = [
  "TRANS_ID=${[№]}",
  "CLASSCODE=SPBFUT",
  "ACTION=Ввод заявки",
  "Торговый счет=${[Торговый счет]}",
  "К/П=${[Направление]}",
  "Тип=Рыночная",
  "Класс=SPBFUT",
  "Инструмент=${[Код инструмента]}",
  "Цена=0",
  "Количество=${[Количество]}",
  "Условие исполнения=Поставить в очередь",
  "Комментарий=/&!62",
  "Переносить заявку=Нет",
  'Дата экспирации=${TEXT(TODAY();"ГГГГММДД")}',
  "Код внешнего пользователя=",
  "",
].join(";");

export const BUILTIN_TEMPLATES: readonly Template[] = [
  {
    id: "forts-expiration",
    name: "Экспирация FORTS",
    description:
      "Закрытие позиций по поставочным фьючерсным контрактам. Вставьте выборку " +
      "из QUIK, отфильтрованную по дате погашения и без активных заявок.",
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
    values: {
      // Закрытие позиции: длинную продаём, короткую откупаем.
      Направление: 'IF([Тек. чист. поз.]>0;"Продажа";"Покупка")',
      Количество: "ABS([Тек. чист. поз.])",
    },
    skipWhen: "[Количество] = 0",
    warnUniform: ["Дата погашения"],
    warnEmpty: ["Акт. покупка", "Акт. продажа"],
    line: FORTS_LINE,
    stats: {
      quantity: "Количество",
      direction: "Направление",
      instrument: "Код инструмента",
      account: "Торговый счет",
    },
  },
];

const STORAGE_KEY = "karman.templates.v1";

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
    values: template.values,
    stats: template.stats,
    skipWhen: template.skipWhen,
    warnUniform: template.warnUniform,
    warnEmpty: template.warnEmpty,
    line: template.line,
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
