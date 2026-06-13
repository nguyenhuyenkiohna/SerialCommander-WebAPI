#!/usr/bin/env bash
# Deploy backend lên production + verify — chạy từ máy dev.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

if [ -z "${DEPLOY_PASSWORD:-}" ]; then
  echo "Thiếu DEPLOY_PASSWORD. Ví dụ:" >&2
  echo "  DEPLOY_PASSWORD='mật-khẩu-SSH' $0" >&2
  exit 1
fi

echo "== [1/3] npm test =="
npm test

echo ""
echo "== [2/3] deploy (release_deploy.py) =="
npm run deploy

echo ""
echo "== [3/3] verify production =="
bash scripts/verify-production-deploy.sh

echo ""
echo "Hoàn tất. Thử tay: https://serial.toolhub.app/login → Đăng nhập Google"
