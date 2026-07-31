-- Без REPLICA IDENTITY FULL Postgres шлёт в Realtime DELETE-события только
-- первичный ключ строки (payload.old = {id}, без остальных полей). Клиент
-- (components/calendar.tsx) на такое падает в дорогой фолбэк — перекачивает
-- ВЕСЬ загруженный диапазон дат заново (может быть полгода-год) для КАЖДОЙ
-- открытой вкладки. С REPLICA IDENTITY FULL payload.old содержит всю строку,
-- и обработка идёт дёшево — просто убираем запись из локального кэша.
ALTER TABLE dezurstva REPLICA IDENTITY FULL;
ALTER TABLE chat_messages REPLICA IDENTITY FULL;
