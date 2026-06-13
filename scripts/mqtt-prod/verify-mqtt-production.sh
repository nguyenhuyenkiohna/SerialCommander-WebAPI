#!/usr/bin/env bash
# Kiểm tra MQTT + remote session từ máy dev (sau khi setup Mosquitto trên VPS).
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-https://api.toolhub.app/serialcommander/health}"
MQTT_HOST="${MQTT_HOST:-mqtt.toolhub.app}"
MQTT_PORT="${MQTT_PORT:-8884}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
fail() { echo -e "${RED}❌ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }

echo "══════════════════════════════════════════════"
echo " Verify MQTT production"
echo "══════════════════════════════════════════════"

echo ""
echo "── DNS ──"
MQTT_IP=$(dig +short "$MQTT_HOST" A 2>/dev/null | tail -1 || true)
API_IP=$(dig +short api.toolhub.app A 2>/dev/null | tail -1 || true)
echo "  $MQTT_HOST → ${MQTT_IP:-?}"
echo "  api.toolhub.app → ${API_IP:-?}"
if [[ -n "$MQTT_IP" && -n "$API_IP" && "$MQTT_IP" != "$API_IP" ]]; then
  warn "mqtt và api khác IP — passwd phải sync sang máy broker (xem README-mqtt-prod.md § B)"
else
  ok "mqtt và api cùng IP (hoặc chưa resolve) — kiến trúc khuyến nghị"
fi

echo ""
echo "── TCP :$MQTT_PORT ──"
if nc -z -w 5 "$MQTT_HOST" "$MQTT_PORT" 2>/dev/null; then
  ok "Port $MQTT_PORT mở trên $MQTT_HOST"
else
  fail "Không kết nối TCP $MQTT_HOST:$MQTT_PORT — broker chưa chạy hoặc firewall"
fi

echo ""
echo "── API health (mqtt) ──"
HEALTH=$(curl -sf --max-time 15 "$HEALTH_URL" 2>/dev/null || echo "")
if [[ -z "$HEALTH" ]]; then
  fail "Health endpoint không phản hồi: $HEALTH_URL"
else
  echo "$HEALTH"
  if echo "$HEALTH" | grep -q '"mqtt"[[:space:]]*:[[:space:]]*"ok"'; then
    ok "health.mqtt = ok"
  elif echo "$HEALTH" | grep -q '"mqtt"[[:space:]]*:[[:space:]]*"skipped"'; then
    warn "health.mqtt = skipped — thêm MQTT_PASSWD_FILE vào .env trên VPS + restart PM2"
  elif echo "$HEALTH" | grep -q '"mqtt"[[:space:]]*:[[:space:]]*"fail"'; then
    fail "health.mqtt = fail — API không ghi được passwd (quyền thư mục?)"
  fi
fi

echo ""
echo "── TLS WSS (openssl) ──"
if echo | openssl s_client -connect "${MQTT_HOST}:${MQTT_PORT}" -servername "$MQTT_HOST" 2>/dev/null | grep -q "Verify return code"; then
  ok "TLS handshake OK"
else
  warn "TLS handshake thất bại hoặc openssl không có — kiểm tra cert trên broker"
fi

echo ""
echo "── E2E thủ công ──"
echo "  1. https://serial.toolhub.app — đăng nhập tab Host"
echo "  2. Hợp tác → Chia sẻ phiên (không banner MQTT_PASSWD_FILE)"
echo "  3. Tab Station → Kết nối từ xa → nhập mã → Tx-Rx hai chiều"
echo ""
ok "Verify script xong"
