#!/usr/bin/env bash
# Đồng bộ passwd từ VPS API sang VPS MQTT riêng (chỉ khi mqtt.toolhub.app ≠ api.toolhub.app).
# Cài trên VPS API, chạy cron mỗi phút HOẶC sau mỗi deploy — tạm thời cho đến khi gộp cùng máy.
#
# Cấu hình:
#   export MQTT_SYNC_REMOTE="huyenntt@103.179.191.14"
#   export MQTT_SYNC_REMOTE_PASSWD="/home/huyenntt/sc-mqtt-prod/config/passwd"
#   export MQTT_SYNC_LOCAL_PASSWD="/home/huyenntt/sc-mqtt-prod/config/passwd"
#   export MQTT_SYNC_CONTAINER="sc-mqtt-prod"
#
# Chạy:
#   ./sync-passwd-to-remote-broker.sh
set -euo pipefail

LOCAL="${MQTT_SYNC_LOCAL_PASSWD:-$HOME/sc-mqtt-prod/config/passwd}"
REMOTE="${MQTT_SYNC_REMOTE:-}"
REMOTE_PASSWD="${MQTT_SYNC_REMOTE_PASSWD:-$HOME/sc-mqtt-prod/config/passwd}"
CONTAINER="${MQTT_SYNC_CONTAINER:-sc-mqtt-prod}"

if [[ -z "$REMOTE" ]]; then
  echo "❌ Set MQTT_SYNC_REMOTE=user@mqtt-host"
  exit 1
fi

if [[ ! -f "$LOCAL" ]]; then
  echo "❌ Không có file local: $LOCAL"
  exit 1
fi

rsync -az "$LOCAL" "${REMOTE}:${REMOTE_PASSWD}"
ssh "$REMOTE" "docker kill -s HUP ${CONTAINER} 2>/dev/null || docker restart ${CONTAINER}"
echo "✅ Đã sync passwd + reload broker trên $REMOTE"
