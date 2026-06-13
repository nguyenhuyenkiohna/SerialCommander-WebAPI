#!/usr/bin/env bash
# Kiểm tra production sau deploy backend — chạy từ máy dev (không cần SSH).
set -euo pipefail

API_BASE="${API_BASE:-https://api.toolhub.app/serialcommander}"
FRONTEND="${FRONTEND:-https://serial.toolhub.app}"

pass=0
fail=0

check() {
  local name="$1"
  shift
  if "$@"; then
    echo "  OK  $name"
    pass=$((pass + 1))
  else
    echo "  FAIL $name"
    fail=$((fail + 1))
  fi
}

echo "== Verify production: $API_BASE =="

health_json="$(curl -sf "$API_BASE/health" 2>/dev/null || true)"
check "GET /health trả JSON" test -n "$health_json"
check "health status=ok" bash -c "echo '$health_json' | grep -q '\"status\":\"ok\"'"
check "health db=ok" bash -c "echo '$health_json' | grep -q '\"db\":\"ok\"'"
check "health redis=ok" bash -c "echo '$health_json' | grep -q '\"redis\":\"ok\"'"
check "health firebase=ok" bash -c "echo '$health_json' | grep -q '\"firebase\":\"ok\"'"

oauth_json="$(curl -sf "$API_BASE/api/auth/google/status" 2>/dev/null || true)"
check "Google OAuth enabled" bash -c "echo '$oauth_json' | grep -q '\"enabled\":true'"

# OAuth initiate: không được set session cookie (fix session Redis)
headers="$(curl -sI "$API_BASE/api/auth/google" 2>/dev/null || true)"
check "OAuth /google không Set-Cookie session" bash -c "! echo '$headers' | grep -qi 'set-cookie.*sess'"

login_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"verify-deploy@test.local","password":"wrong"}' 2>/dev/null || echo 000)"
check "Login API phản hồi (không 503)" bash -c "test '$login_code' != '503' && test '$login_code' != '000'"

fe_code="$(curl -s -o /dev/null -w '%{http_code}' "$FRONTEND/" 2>/dev/null || echo 000)"
check "Frontend HTTP 200" test "$fe_code" = "200"

echo ""
echo "Kết quả: $pass pass, $fail fail"
if [ "$fail" -gt 0 ]; then
  exit 1
fi
echo "Tất cả kiểm tra tự động đã pass. Thử tay: đăng nhập Google trên $FRONTEND/login"
