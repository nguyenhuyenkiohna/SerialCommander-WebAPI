#!/usr/bin/env bash
# Tạo passwd + user healthcheck (Docker healthcheck).
# User phiên remote do API ghi qua MQTT_PASSWD_FILE.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="${DIR}/config"
PASSWD="${CONFIG}/passwd"
HEALTH_PW="${MQTT_HEALTHCHECK_PASSWORD:-sc_mqtt_health_prod}"

mkdir -p "$CONFIG"

run_docker_passwd() {
  if [[ -f "$PASSWD" ]]; then
    docker run --rm -v "${CONFIG}:/cfg" eclipse-mosquitto:2 \
      mosquitto_passwd -b /cfg/passwd healthcheck "$HEALTH_PW"
  else
    docker run --rm -v "${CONFIG}:/cfg" eclipse-mosquitto:2 \
      mosquitto_passwd -b -c /cfg/passwd healthcheck "$HEALTH_PW"
  fi
}

if command -v mosquitto_passwd >/dev/null 2>&1; then
  if [[ -f "$PASSWD" ]]; then
    mosquitto_passwd -b "$PASSWD" healthcheck "$HEALTH_PW"
  else
    mosquitto_passwd -b -c "$PASSWD" healthcheck "$HEALTH_PW"
  fi
else
  run_docker_passwd
fi

chmod 664 "$PASSWD" 2>/dev/null || true
echo "✅ ${PASSWD} — user healthcheck sẵn sàng."
