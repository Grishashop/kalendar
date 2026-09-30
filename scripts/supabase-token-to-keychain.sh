#!/usr/bin/env bash
# Кладёт Supabase access token в macOS Keychain (сервис supabase-mcp-token).
# Токен вводится скрытно и нигде не печатается и не пишется в файлы.
#
# Запуск:  ./scripts/supabase-token-to-keychain.sh
# Чтение:  security find-generic-password -a "$USER" -s supabase-mcp-token -w
# Удаление: security delete-generic-password -a "$USER" -s supabase-mcp-token

set -euo pipefail

SERVICE="supabase-mcp-token"
ACCOUNT="${USER:-$(id -un)}"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Скрипт только для macOS (нужна утилита security)." >&2
  exit 1
fi

printf "Вставьте Supabase access token (ввод скрыт): "
IFS= read -rs TOKEN
printf "\n"

# Убираем пробелы и переводы строк по краям, если токен вставили с ними.
TOKEN="${TOKEN#"${TOKEN%%[![:space:]]*}"}"
TOKEN="${TOKEN%"${TOKEN##*[![:space:]]}"}"

if [[ -z "$TOKEN" ]]; then
  echo "Пустой ввод, ничего не сохранено." >&2
  exit 1
fi

if [[ ! "$TOKEN" =~ ^sb[a-z]_[A-Za-z0-9_-]{20,}$ ]]; then
  echo "Значение не похоже на токен Supabase (ожидается sbp_... или sbs_...). Ничего не сохранено." >&2
  unset TOKEN
  exit 1
fi

# -U: обновить запись, если она уже есть.
security add-generic-password -a "$ACCOUNT" -s "$SERVICE" -U -w "$TOKEN"
unset TOKEN

echo "Готово: токен сохранён в Keychain (сервис: $SERVICE, аккаунт: $ACCOUNT)."
