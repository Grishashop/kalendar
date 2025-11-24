/**
 * Утилиты для работы с датами в московском времени (UTC+3)
 * Это необходимо, так как пользователи живут в Москве, а хостинг может быть в другом часовом поясе
 */

/**
 * Получает текущую дату в московском времени
 */
export function getMoscowDate(): Date {
  const now = new Date();
  // Получаем московское время (UTC+3)
  const moscowTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  return moscowTime;
}

/**
 * Форматирует дату в формат YYYY-MM-DD в московском времени
 */
export function formatDateMoscow(date: Date): string {
  // Используем московское время для форматирования
  const moscowDate = new Date(date.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  const year = moscowDate.getFullYear();
  const month = String(moscowDate.getMonth() + 1).padStart(2, '0');
  const day = String(moscowDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Создает Date объект из строки YYYY-MM-DD, интерпретируя её как московское время
 */
export function parseDateMoscow(dateStr: string): Date {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1; // месяц в JS начинается с 0
  const day = parseInt(dayStr, 10);
  
  // Создаем дату в московском времени
  // Используем UTC и добавляем смещение для Москвы (UTC+3)
  const utcDate = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  // Вычитаем 3 часа, чтобы получить московское время
  const moscowOffset = 3 * 60 * 60 * 1000; // 3 часа в миллисекундах
  const moscowDate = new Date(utcDate.getTime() - moscowOffset);
  
  return moscowDate;
}

/**
 * Получает компоненты даты (год, месяц, день) в московском времени
 */
export function getMoscowDateComponents(date: Date): { year: number; month: number; day: number } {
  const moscowDate = new Date(date.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  return {
    year: moscowDate.getFullYear(),
    month: moscowDate.getMonth() + 1, // месяц от 1 до 12
    day: moscowDate.getDate(),
  };
}

/**
 * Создает Date объект для начала дня в московском времени
 */
export function createMoscowDate(year: number, month: number, day: number): Date {
  // month должен быть от 1 до 12 (не от 0 до 11)
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  // Вычитаем 3 часа для московского времени
  const moscowOffset = 3 * 60 * 60 * 1000;
  const moscowDate = new Date(utcDate.getTime() - moscowOffset);
  return moscowDate;
}

