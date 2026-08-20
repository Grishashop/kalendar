"use client";

import { DutyCalendar } from "@/components/duty-calendar";

// Календарь дежурств отдела поддержки клиентов. Смены не заданы кодом: их
// названия знает сам отдел, и администратор правит их на странице кнопкой
// «Смены». Начальный набор — заведомо предположение, а не согласованный список.
export default function SupportCalendarPage() {
  return (
    <DutyCalendar
      apiPath="/api/support-calendar"
      storageKey="support-calendar-admin-password"
      subtitle="Дежурства отдела поддержки клиентов"
      footer="Отдельная страница отдела поддержки: расписание хранится независимо от календаря трейдеров и правится своим паролем. Названия и цвета смен настраиваются кнопкой «Смены» после входа."
    />
  );
}
