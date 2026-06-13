#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Serial Commander — cài Mosquitto production trên VPS API (api.toolhub.app)
#
# Chạy TRÊN VPS (SSH):
#   cd ~/serialcommander_webapi/scripts/mqtt-prod
#   chmod +x setup-on-vps.sh init-passwd.sh
#   ./setup-on-vps.sh
#
# Hoặc từ máy local (cần DEPLOY_PASSWORD hoặc SSH key):
#   DEPLOY_PASSWORD='...' ./setup-on-vps.sh --remote huyenntt@api.toolhub.app
#
# Yêu cầu:
#   • Docker + quyền docker (user trong group docker)
#   • Cert TLS cho mqtt.toolhub.app (Let's Encrypt) — hoặc --skip-tls-check để dry-run
#   • DNS mqtt.toolhub.app trỏ IP VPS API (103.124.92.62) — KHUYẾN NGHỊ cùng máy API
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE=""
SKIP_TLS_CHECK=false
DRY_RUN=false
CONTAINER_NAME="sc-mqtt-prod"
CERT_DIR="${MQTT_TLS_DIR:-/etc/letsencrypt/live/mqtt.toolhub.app}"
API_HOME=""
MQTT_HOME=""

usage() {
  sed -n '2,12p' "$0"
  echo ""
  echo "Options:"
  echo "  --remote USER@HOST     SSH chạy lệnh trên VPS"
  echo "  --mqtt-home PATH       Thư mục Mosquitto (mặc định ~/sc-mqtt-prod)"
  echo "  --api-home PATH        Thư mục WebAPI (mặc định ~/serialcommander_webapi)"
  echo "  --cert-dir PATH        Let's Encrypt live dir (mặc định /etc/letsencrypt/live/mqtt.toolhub.app)"
  echo "  --skip-tls-check       Bỏ qua kiểm tra cert (chỉ kiểm tra file cấu hình)"
  echo "  --dry-run              In lệnh, không ghi file / không restart"
  echo "  -h, --help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote) REMOTE="$2"; shift 2 ;;
    --mqtt-home) MQTT_HOME="$2"; PASSWD_ABS="${MQTT_HOME}/config/passwd"; shift 2 ;;
    --api-home) API_HOME="$2"; ENV_FILE="$API_HOME/.env"; shift 2 ;;
    --cert-dir) CERT_DIR="$2"; shift 2 ;;
    --skip-tls-check) SKIP_TLS_CHECK=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ -n "$REMOTE" ]]; then
  API_HOME="${API_HOME:-/home/huyenntt/serialcommander_webapi}"
  MQTT_HOME="${MQTT_HOME:-/home/huyenntt/sc-mqtt-prod}"
else
  API_HOME="${API_HOME:-$HOME/serialcommander_webapi}"
  MQTT_HOME="${MQTT_HOME:-$HOME/sc-mqtt-prod}"
fi
ENV_FILE="${ENV_FILE:-$API_HOME/.env}"
PASSWD_ABS="${MQTT_HOME}/config/passwd"

# Payload bash chạy trên VPS
VPS_SCRIPT=$(cat <<'VPS_EOF'
set -euo pipefail

SCRIPT_DIR="$1"
MQTT_HOME="$2"
API_HOME="$3"
ENV_FILE="$4"
CERT_DIR="$5"
CONTAINER_NAME="$6"
SKIP_TLS_CHECK="$7"
DRY_RUN="$8"

green() { printf '\033[0;32m✅ %s\033[0m\n' "$*"; }
yellow() { printf '\033[1;33m⚠️  %s\033[0m\n' "$*"; }
red() { printf '\033[0;31m❌ %s\033[0m\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  red "Docker chưa cài — cài Docker trước (hoặc liên hệ admin VPS)."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  red "User $(whoami) không chạy được docker — thêm vào group docker: sudo usermod -aG docker $(whoami)"
  exit 1
fi

# ── 1. TLS cert ──────────────────────────────────────────────────────────────
if [[ "$SKIP_TLS_CHECK" != "true" ]]; then
  if [[ ! -f "$CERT_DIR/fullchain.pem" || ! -f "$CERT_DIR/privkey.pem" ]]; then
    red "Thiếu cert TLS tại $CERT_DIR"
    echo ""
    echo "Tạo cert (chọn một):"
    echo "  A) certbot standalone (tạm dừng service chiếm :80/:443 nếu cần):"
    echo "     sudo certbot certonly --standalone -d mqtt.toolhub.app"
    echo "  B) certbot webroot (nếu đã có nginx):"
    echo "     sudo certbot certonly --webroot -w /var/www/html -d mqtt.toolhub.app"
    echo ""
    echo "Sau đó chạy lại script. Hoặc: --skip-tls-check (chỉ copy file, chưa start broker)."
    exit 1
  fi
  green "TLS cert OK: $CERT_DIR"
else
  yellow "Bỏ qua kiểm tra TLS (--skip-tls-check)"
fi

# ── 2. Copy cấu hình Mosquitto ───────────────────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
  yellow "DRY-RUN: sẽ tạo $MQTT_HOME từ $SCRIPT_DIR"
else
  mkdir -p "$MQTT_HOME/config" "$MQTT_HOME/data" "$MQTT_HOME/certs"
  cp "$SCRIPT_DIR/mosquitto.conf" "$MQTT_HOME/config/mosquitto.conf"
  cp "$SCRIPT_DIR/acl" "$MQTT_HOME/config/acl"
  cp "$SCRIPT_DIR/docker-compose.yml" "$MQTT_HOME/docker-compose.yml"
  cp "$SCRIPT_DIR/init-passwd.sh" "$MQTT_HOME/init-passwd.sh"
  chmod +x "$MQTT_HOME/init-passwd.sh"

  if [[ -f "$CERT_DIR/fullchain.pem" ]]; then
    ln -sf "$CERT_DIR/fullchain.pem" "$MQTT_HOME/certs/fullchain.pem"
    ln -sf "$CERT_DIR/privkey.pem" "$MQTT_HOME/certs/privkey.pem"
  fi

  cd "$MQTT_HOME"
  ./init-passwd.sh
  green "Đã copy config → $MQTT_HOME"
fi

# ── 3. Cập nhật .env API ─────────────────────────────────────────────────────
PASSWD_ABS="${MQTT_HOME}/config/passwd"
ENV_BLOCK="
# --- MQTT remote session (setup-on-vps.sh $(date +%Y-%m-%d)) ---
MQTT_PASSWD_FILE=${PASSWD_ABS}
MQTT_BROKER_HUP_CONTAINER=${CONTAINER_NAME}
MQTT_BROKER_RELOAD_DELAY_MS=1500
"

if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^MQTT_PASSWD_FILE=' "$ENV_FILE" 2>/dev/null; then
    yellow ".env đã có MQTT_PASSWD_FILE — kiểm tra tay:"
    grep '^MQTT_' "$ENV_FILE" || true
  elif [[ "$DRY_RUN" != "true" ]]; then
    printf '%s\n' "$ENV_BLOCK" >> "$ENV_FILE"
    green "Đã thêm MQTT_* vào $ENV_FILE"
  fi
else
  red "Không tìm thấy $ENV_FILE — deploy WebAPI trước hoặc set ENV_FILE"
  exit 1
fi

# ── 4. Docker Compose up ─────────────────────────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
  yellow "DRY-RUN: docker compose -f $MQTT_HOME/docker-compose.yml up -d"
else
  cd "$MQTT_HOME"
  export MQTT_TLS_DIR="$MQTT_HOME/certs"
  docker compose pull
  docker compose up -d
  sleep 3
  docker compose ps
  if docker compose ps --status running | grep -q "$CONTAINER_NAME"; then
    green "Mosquitto container đang chạy"
  else
    red "Container chưa running — xem: docker logs $CONTAINER_NAME"
    exit 1
  fi
fi

# ── 5. Restart API (PM2) ─────────────────────────────────────────────────────
if [[ "$DRY_RUN" != "true" ]] && command -v pm2 >/dev/null 2>&1; then
  if pm2 describe serialcommander-api >/dev/null 2>&1; then
    pm2 restart serialcommander-api --update-env
    green "PM2 serialcommander-api restarted"
  else
    yellow "Không thấy PM2 app serialcommander-api — restart API thủ công"
  fi
fi

# ── 6. Firewall reminder ─────────────────────────────────────────────────────
yellow "Đảm bảo firewall mở TCP 8884 (WSS):"
echo "  sudo ufw allow 8884/tcp   # hoặc rule tương đương trên panel VPS"
echo ""
yellow "DNS: mqtt.toolhub.app → IP máy này ($(curl -sf --max-time 3 ifconfig.me 2>/dev/null || echo '?'))"

echo ""
echo "── Kiểm tra ──"
echo "  curl -s https://api.toolhub.app/serialcommander/health | jq .mqtt"
echo "  ss -tlnp | grep 8884"
echo "  docker logs $CONTAINER_NAME --tail 30"
VPS_EOF
)

if [[ -n "$REMOTE" ]]; then
  # Trên VPS: scripts nằm trong thư mục deploy WebAPI (user huyenntt).
  REMOTE_SCRIPT_DIR="${REMOTE_SCRIPT_DIR:-/home/huyenntt/serialcommander_webapi/scripts/mqtt-prod}"
  echo "══ SSH → $REMOTE ══"
  ssh "$REMOTE" "bash -s" -- \
    "$REMOTE_SCRIPT_DIR" "$MQTT_HOME" "$API_HOME" "$ENV_FILE" "$CERT_DIR" "$CONTAINER_NAME" "$SKIP_TLS_CHECK" "$DRY_RUN" \
    <<< "$VPS_SCRIPT"
else
  bash -s -- \
    "$SCRIPT_DIR" "$MQTT_HOME" "$API_HOME" "$ENV_FILE" "$CERT_DIR" "$CONTAINER_NAME" "$SKIP_TLS_CHECK" "$DRY_RUN" \
    <<< "$VPS_SCRIPT"
fi

echo ""
echo "══════════════════════════════════════════════════════════════"
echo " Xong. Test: https://serial.toolhub.app → Hợp tác → Chia sẻ phiên"
echo "══════════════════════════════════════════════════════════════"
