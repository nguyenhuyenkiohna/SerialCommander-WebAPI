/**
 * Singleton registry cho tất cả Redis clients trong hệ thống.
 * Tránh tạo nhiều connection pools riêng lẻ ở từng module.
 *
 * Mỗi logical function dùng một Redis DB index riêng (qua URL env),
 * nhưng đều đi qua factory chung để có logging và error handling nhất quán.
 */
const { createRedisClient } = require("./redisClientFactory");

let _outboxClient = null;
let _sessionClient = null;
let _schedulerClient = null;
let _authCleanupClient = null;

function resolveUrl(envKeys) {
  for (const key of envKeys) {
    const v = process.env[key];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function getOutboxClient() {
  if (_outboxClient !== null) return _outboxClient;
  const url = resolveUrl([
    "SCENARIO_OUTBOX_REDIS_URL",
    "SCENARIO_SYNC_REDIS_URL",
    "SCHEDULER_SHARED_REDIS_URL",
    "RATE_LIMIT_REDIS_URL",
  ]);
  const { client } = createRedisClient({ url, label: "outbox" });
  _outboxClient = client;
  return _outboxClient;
}

function getSessionClient() {
  if (_sessionClient !== null) return _sessionClient;
  const url = resolveUrl([
    "REMOTE_SESSION_REDIS_URL",
    "SCHEDULER_SHARED_REDIS_URL",
    "RATE_LIMIT_REDIS_URL",
  ]);
  const { client } = createRedisClient({ url, label: "remote-session" });
  _sessionClient = client;
  return _sessionClient;
}

function getSchedulerClient() {
  if (_schedulerClient !== null) return _schedulerClient;
  const url = resolveUrl([
    "SCHEDULER_SHARED_REDIS_URL",
    "SCENARIO_SYNC_REDIS_URL",
    "RATE_LIMIT_REDIS_URL",
  ]);
  const { client } = createRedisClient({ url, label: "scheduler" });
  _schedulerClient = client;
  return _schedulerClient;
}

function getAuthCleanupClient() {
  if (_authCleanupClient !== null) return _authCleanupClient;
  const url = resolveUrl([
    "SCHEDULER_SHARED_REDIS_URL",
    "AUTH_CODE_CLEANUP_REDIS_URL",
    "RATE_LIMIT_REDIS_URL",
  ]);
  const { client } = createRedisClient({ url, label: "auth-cleanup" });
  _authCleanupClient = client;
  return _authCleanupClient;
}

/** Test-only: reset tất cả singleton clients. */
function _resetAllClientsForTests() {
  _outboxClient = null;
  _sessionClient = null;
  _schedulerClient = null;
  _authCleanupClient = null;
}

module.exports = {
  getOutboxClient,
  getSessionClient,
  getSchedulerClient,
  getAuthCleanupClient,
  _resetAllClientsForTests,
};
