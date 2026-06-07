#!/usr/bin/env bash
# Chạy migrations SQL theo thứ tự (cần mysql client trên VPS hoặc máy dev).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIG_DIR="$APP_DIR/migrations"

HOST="${MYSQL_HOST:-127.0.0.1}"
PORT="${MYSQL_PORT:-3306}"
USER="${MYSQL_USER:-sc_user}"
PASS="${MYSQL_PASSWORD:-sc_pass}"
DB="${MYSQL_DATABASE:-serialcommander}"

if ! command -v mysql >/dev/null 2>&1; then
  echo "❌ Cần cài mysql client"
  exit 1
fi

export MYSQL_PWD="$PASS"

run_sql() {
  local f="$1"
  echo "→ $(basename "$f")"
  if [[ "$IGNORE_DUPLICATE" == "1" ]]; then
    mysql -h "$HOST" -P "$PORT" -u "$USER" "$DB" < "$f" || {
      echo "⚠️  $(basename "$f") — bỏ qua lỗi (có thể đã áp dụng)"
    }
  else
    mysql -h "$HOST" -P "$PORT" -u "$USER" "$DB" < "$f"
  fi
}

echo "📦 Migrate DB $DB @ $HOST:$PORT"

ORDER=(
  "0000_app_schema_registry.sql"
  "add_google_oauth_fields.sql"
  "2026-05-19_cleanup_users_duplicate_indexes.sql"
  "create_user_activities_table.sql"
  "2026-01-06_add_userid_to_passwordresets.sql"
  "2026-01-06_add_unique_index_users_email.sql"
  "2026-04-03_add_isVerified_to_users.sql"
  "2026-05-09_create_email_verification_codes.sql"
  "2026-05-09_create_sync_jobs.sql"
  "2026-05-09_add_indexes_for_auth_code_lookup.sql"
  "2026-05-09_add_indexes_for_auth_code_retention_cleanup.sql"
  "2026-05-09_add_unique_index_users_username.sql"
  "2026-05-09_set_schema_version_7.sql"
  "2026-05-09_set_schema_version_8.sql"
  "2026-05-09_set_schema_version_9.sql"
  "2026-05-09_set_schema_version_10.sql"
  "2026-05-09_set_schema_version_11.sql"
  "2026-05-18_create_remote_sessions.sql"
  "2026-05-19_remote_sessions_join_challenge.sql"
  "2026-05-20_email_verification_pending_registration.sql"
  "2026-06-01_add_worker_id_to_sync_jobs.sql"
  "2026-06-03_set_schema_version_13.sql"
  "2026-06-07_scenarios_timestamps.sql"
  "2026-06-07_set_schema_version_14.sql"
)

IGNORE_DUPLICATE="${IGNORE_DUPLICATE:-0}"

for name in "${ORDER[@]}"; do
  f="$MIG_DIR/$name"
  if [[ ! -f "$f" ]]; then
    echo "⚠️  Bỏ qua (không tồn tại): $name"
    continue
  fi
  run_sql "$f"
done

echo "✅ Migration xong. Kiểm tra: SELECT schema_version FROM app_schema_registry WHERE singleton_id=1;"
