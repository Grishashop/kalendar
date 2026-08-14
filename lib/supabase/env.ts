/**
 * Наличие настроек Supabase. Живёт рядом с клиентом, а не в `lib/utils`, потому
 * что `cn()` из utils импортирует каждый UI-компонент: чтение `process.env`
 * в том же модуле тянуло обращение к Supabase в любую сборку, включая офлайн,
 * где объекта `process` не существует и бандл падал на старте.
 */
export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
