// Фиксированный набор ~40 самых весомых по индексу IMOEX бумаг,
// сгруппированных по отраслям (агрегация по факт. составу и весам IMOEX,
// проверено вручную по live-данным MOEX ISS) — для вида «По отраслям» на
// дашборде и вселенной дивидендного календаря в /api/market/events.
// Перенесено дословно из app/api/market/route.ts.
// Порядок секторов и бумаг внутри — по убыванию суммарного веса в индексе.
export const SECTOR_GROUPS: { sector: string; items: { secid: string; name: string }[] }[] = [
  {
    sector: "Нефть и газ",
    items: [
      { secid: "LKOH", name: "Лукойл" },
      { secid: "GAZP", name: "Газпром" },
      { secid: "TATN", name: "Татнефть" },
      { secid: "NVTK", name: "Новатэк" },
      { secid: "ROSN", name: "Роснефть" },
      { secid: "SNGS", name: "Сургутнефтегаз" },
      { secid: "TRNFP", name: "Транснефть" },
    ],
  },
  {
    sector: "Финансы",
    items: [
      { secid: "SBER", name: "Сбербанк" },
      { secid: "T", name: "Т-Технологии" },
      { secid: "VTBR", name: "ВТБ" },
      { secid: "MOEX", name: "МосБиржа" },
      { secid: "CBOM", name: "МКБ" },
      { secid: "DOMRF", name: "ДОМ.РФ" },
      { secid: "SVCB", name: "Совкомбанк" },
    ],
  },
  {
    sector: "Металлы и добыча",
    items: [
      { secid: "GMKN", name: "Норникель" },
      { secid: "PLZL", name: "Полюс" },
      { secid: "CHMF", name: "Северсталь" },
      { secid: "RUAL", name: "Русал" },
      { secid: "NLMK", name: "НЛМК" },
      { secid: "MAGN", name: "ММК" },
      { secid: "ALRS", name: "АЛРОСА" },
    ],
  },
  {
    sector: "Электроэнергетика",
    items: [
      { secid: "IRAO", name: "ИнтерРАО" },
      { secid: "MSNG", name: "Мосэнерго" },
    ],
  },
  {
    sector: "Транспорт",
    items: [
      { secid: "AFLT", name: "Аэрофлот" },
      { secid: "FLOT", name: "Совкомфлот" },
    ],
  },
  {
    sector: "Химия",
    items: [
      { secid: "PHOR", name: "ФосАгро" },
      { secid: "AKRN", name: "Акрон" },
    ],
  },
  {
    sector: "Технологии",
    items: [
      { secid: "YDEX", name: "Яндекс" },
      { secid: "HEAD", name: "Хэдхантер" },
      { secid: "VKCO", name: "VK" },
      { secid: "POSI", name: "Позитив" },
      { secid: "CNRU", name: "Циан" },
    ],
  },
  {
    sector: "Потребительский сектор",
    items: [
      { secid: "OZON", name: "Озон" },
      { secid: "X5", name: "Х5" },
      { secid: "LENT", name: "Лента" },
      { secid: "RAGR", name: "Русагро" },
      { secid: "MDMG", name: "Мать и Дитя" },
    ],
  },
  {
    sector: "Телекоммуникации",
    items: [
      { secid: "MTSS", name: "МТС" },
      { secid: "RTKM", name: "Ростелеком" },
    ],
  },
];
