/**
 * Файл транзакций QUIK (.tri) в кодировке windows-1251.
 *
 * QUIK не читает UTF-8 — проверено на выгрузке самого терминала, он пишет
 * tri-файлы в ANSI. Поэтому браузерный `Blob` использовать напрямую нельзя:
 * он кодирует строку в UTF-8, и русские имена полей приедут в терминал
 * нечитаемыми. Байты собираются здесь вручную.
 *
 * Системный `TextDecoder("windows-1251")` для построения таблицы не годится:
 * в браузере он есть, но модуль грузится и на сервере, а там легаси-кодировки
 * не гарантированы — Bun их не знает вовсе, и падение случилось бы на импорте.
 */

/**
 * Хвост таблицы регулярен: А–Я и а–я лежат непрерывно с 0xC0, то есть 64 из 128
 * позиций закрываются арифметикой, где опечатка невозможна.
 */
const CYRILLIC_FIRST = 0x0410;
const CYRILLIC_LAST = 0x044f;
const CYRILLIC_BASE = 0xc0;

/**
 * Остальные позиции заданы парами «код символа → байт». Числами, а не буквами:
 * литерал вроде «Ў» против «У» глазом в ревью не различить, а ошибка всплыла бы
 * однажды в комментарии к заявке. Таблица сверена с декодером cp1251.
 */
const EXTRA: ReadonlyMap<string, number> = new Map(
  (
    [
      [0x0402, 0x80], [0x0403, 0x81], [0x201a, 0x82], [0x0453, 0x83],
      [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
      [0x20ac, 0x88], [0x2030, 0x89], [0x0409, 0x8a], [0x2039, 0x8b],
      [0x040a, 0x8c], [0x040c, 0x8d], [0x040b, 0x8e], [0x040f, 0x8f],
      [0x0452, 0x90], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
      [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
      [0x2122, 0x99], [0x0459, 0x9a], [0x203a, 0x9b], [0x045a, 0x9c],
      [0x045c, 0x9d], [0x045b, 0x9e], [0x045f, 0x9f],
      [0x00a0, 0xa0], [0x040e, 0xa1], [0x045e, 0xa2], [0x0408, 0xa3],
      [0x00a4, 0xa4], [0x0490, 0xa5], [0x00a6, 0xa6], [0x00a7, 0xa7],
      [0x0401, 0xa8], [0x00a9, 0xa9], [0x0404, 0xaa], [0x00ab, 0xab],
      [0x00ac, 0xac], [0x00ad, 0xad], [0x00ae, 0xae], [0x0407, 0xaf],
      [0x00b0, 0xb0], [0x00b1, 0xb1], [0x0406, 0xb2], [0x0456, 0xb3],
      [0x0491, 0xb4], [0x00b5, 0xb5], [0x00b6, 0xb6], [0x00b7, 0xb7],
      [0x0451, 0xb8], [0x2116, 0xb9], [0x0454, 0xba], [0x00bb, 0xbb],
      [0x0458, 0xbc], [0x0405, 0xbd], [0x0455, 0xbe], [0x0457, 0xbf],
    ] as const
  ).map(([codePoint, byte]) => [String.fromCharCode(codePoint), byte] as const),
);

/** Байт windows-1251 для символа; undefined — символа в кодировке нет. */
export function byteFor(char: string): number | undefined {
  const code = char.charCodeAt(0);
  if (code < 0x80) return code;
  if (code >= CYRILLIC_FIRST && code <= CYRILLIC_LAST) {
    return code - CYRILLIC_FIRST + CYRILLIC_BASE;
  }
  return EXTRA.get(char);
}

export interface EncodeResult {
  bytes: Uint8Array;
  /** Символы, которых нет в windows-1251, в порядке первого появления. */
  unmapped: string[];
}

/**
 * Кодирует текст в windows-1251. Непредставимые символы НЕ заменяются молча:
 * подстановка «?» испортила бы поле транзакции, а цена такой ошибки —
 * отвергнутая или, хуже, неверно исполненная заявка. Вызывающий обязан
 * проверить `unmapped` и не писать файл, если список не пуст.
 */
export function toWindows1251(text: string): EncodeResult {
  const bytes = new Uint8Array(text.length);
  const unmapped: string[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const mapped = byteFor(char);
    if (mapped === undefined) {
      bytes[i] = 0x3f;
      if (!unmapped.includes(char)) unmapped.push(char);
      continue;
    }
    bytes[i] = mapped;
  }

  return { bytes, unmapped };
}

/**
 * Имя файла с датой и временем: за квартал в папке загрузок набирается
 * несколько пачек, и «transactions (3).tri» не говорит ни о чём.
 */
export function triFileName(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `karman-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}.tri`;
}
