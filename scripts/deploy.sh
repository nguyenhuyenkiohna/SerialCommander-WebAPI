#!/usr/bin/env bash
# Kịch bản deploy thủ công — chỉnh APP_DIR / ENV_FILE cho phù hợp server.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$APP_DIR"

ENV_FILE="${ENV_FILE:-.env}"

echo "== Serial Commander WebAPI deploy =="
echo "APP_DIR=$APP_DIR"
echo "ENV_FILE=$ENV_FILE"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Thiếu file env trên server: tạo .env từ .env.production.example hoặc upload .env.production." >&2
  exit 1
fi

echo ""
echo "[1/5] Cài dependency production..."
npm ci --omit=dev --legacy-peer-deps

echo ""
echo "[2/5] Migration SQL"
AUTO_RUN_MIGRATION="${AUTO_RUN_MIGRATION:-false}"
if [[ "$AUTO_RUN_MIGRATION" == "true" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  export MYSQL_HOST="${DATABASE_HOST:-${PROD_DB_HOSTNAME:-}}"
  export MYSQL_PORT="${DATABASE_PORT:-${PROD_DB_PORT:-3306}}"
  export MYSQL_USER="${DATABASE_USERNAME:-${PROD_DB_USERNAME:-}}"
  export MYSQL_PASSWORD="${DATABASE_PASSWORD:-${PROD_DB_PASSWORD:-}}"
  export MYSQL_DATABASE="${DATABASE_NAME:-${PROD_DB_NAME:-}}"
  export MYSQL_PWD="$MYSQL_PASSWORD"
  IGNORE_DUPLICATE=1 bash "$SCRIPT_DIR/migrate-mysql.sh" || {
    echo "Migration có cảnh báo — kiểm tra log phía trên." >&2
  }
else
  echo "Chạy migration (từ máy dev hoặc VPS có mysql client):"
  echo "  ./scripts/migrate-production.sh   # máy dev + .env.production"
  echo "  hoặc AUTO_RUN_MIGRATION=true ENV_FILE=.env ./scripts/deploy.sh"
  AUTO_APPROVE_MIGRATION="${AUTO_APPROVE_MIGRATION:-false}"
  if [[ "$AUTO_APPROVE_MIGRATION" != "true" ]]; then
    read -r -p "Đã chạy xong migration SQL trên DB production chưa? (y/N) " ok
    if [[ "${ok:-}" != "y" && "${ok:-}" != "Y" ]]; then
      echo "Dừng deploy — hoàn tất migration rồi chạy lại." >&2
      exit 1
    fi
  fi
fi

echo ""
echo "[3/5] Preflight (env + DB + schema version)..."
ENV_FILE="$ENV_FILE" NODE_ENV=production npm run preflight

echo ""
echo "[4/5] Firebase / uploads — đảm bảo FIREBASE_SERVICE_ACCOUNT_PATH và uploads/."

echo ""
echo "[5/5] PM2"
AUTO_RELOAD_PM2="${AUTO_RELOAD_PM2:-false}"
if [[ "$AUTO_RELOAD_PM2" == "true" ]]; then
  NODE_ENV=production pm2 reload pm2.config.js --update-env || true
  pm2 ls || true
else
  echo "  NODE_ENV=production pm2 reload pm2.config.js --update-env"
  read -r -p "Chạy pm2 reload ngay? (y/N) " pm2ok
  if [[ "${pm2ok:-}" == "y" || "${pm2ok:-}" == "Y" ]]; then
    NODE_ENV=production pm2 reload pm2.config.js --update-env || true
    pm2 ls || true
  fi
fi

echo "Hoàn tất."
