#!/bin/sh
set -e

DB_HOST="${DATABASE_HOST:-mysql}"
DB_PORT="${DATABASE_PORT:-3306}"

echo "[entrypoint] Waiting for MySQL at ${DB_HOST}:${DB_PORT}..."
until nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
  sleep 1
done
echo "[entrypoint] MySQL is up."

if [ "${WAIT_FOR_REDIS:-true}" = "true" ]; then
  REDIS_HOST="${REDIS_HOST:-redis}"
  REDIS_PORT="${REDIS_PORT:-6379}"
  echo "[entrypoint] Waiting for Redis at ${REDIS_HOST}:${REDIS_PORT}..."
  until nc -z "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null; do
    sleep 1
  done
  echo "[entrypoint] Redis is up."
fi

exec node server.js
