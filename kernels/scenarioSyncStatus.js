const { getOutboxClient } = require("./redis/redisClients");
const { logWarn } = require("./logging/appLogger");

const STATUS_HASH_KEY = "scenario:sync:status";
const CIRCUIT_KEY = "sync:firestore:circuit_open";
const CIRCUIT_TTL_SEC = 60;
const CIRCUIT_FAILURE_THRESHOLD = 5;

let consecutiveFirestoreFailures = 0;

async function getRedis() {
  const client = getOutboxClient();
  if (!client) return null;
  if (client.status !== "ready") {
    try {
      await client.connect();
    } catch {
      return null;
    }
  }
  return client;
}

async function setScenarioSyncStatus(scenarioId, status) {
  if (!scenarioId || !status) return;
  const client = await getRedis();
  if (!client) return;
  try {
    await client.hset(STATUS_HASH_KEY, scenarioId, status);
  } catch (err) {
    logWarn("[scenario-sync-status] hset failed", {
      scenarioId,
      status,
      message: err.message || String(err),
    });
  }
}

async function getScenarioSyncStatus(scenarioId) {
  if (!scenarioId) return null;
  const client = await getRedis();
  if (!client) return null;
  try {
    return await client.hget(STATUS_HASH_KEY, scenarioId);
  } catch {
    return null;
  }
}

async function getScenarioSyncStatusBatch(scenarioIds) {
  const map = new Map();
  if (!scenarioIds?.length) return map;
  const client = await getRedis();
  if (!client) return map;
  const unique = [...new Set(scenarioIds.filter(Boolean))];
  try {
    const values = await client.hmget(STATUS_HASH_KEY, ...unique);
    unique.forEach((id, i) => {
      if (values[i]) map.set(id, values[i]);
    });
  } catch {
    /* best-effort */
  }
  return map;
}

async function clearScenarioSyncStatus(scenarioId) {
  if (!scenarioId) return;
  const client = await getRedis();
  if (!client) return;
  try {
    await client.hdel(STATUS_HASH_KEY, scenarioId);
  } catch {
    /* noop */
  }
}

function recordFirestoreBatchSuccess() {
  consecutiveFirestoreFailures = 0;
}

async function recordFirestoreBatchFailure() {
  consecutiveFirestoreFailures += 1;
  if (consecutiveFirestoreFailures < CIRCUIT_FAILURE_THRESHOLD) return false;
  const client = await getRedis();
  if (!client) return true;
  try {
    await client.set(CIRCUIT_KEY, "1", "EX", CIRCUIT_TTL_SEC);
    logWarn("[scenario-sync-status] Firestore circuit open", {
      ttl_sec: CIRCUIT_TTL_SEC,
      consecutive_failures: consecutiveFirestoreFailures,
    });
  } catch {
    /* noop */
  }
  return true;
}

async function isFirestoreCircuitOpen() {
  const client = await getRedis();
  if (!client) return false;
  try {
    const v = await client.get(CIRCUIT_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

function resetCircuitForTests() {
  consecutiveFirestoreFailures = 0;
}

module.exports = {
  STATUS_HASH_KEY,
  CIRCUIT_KEY,
  setScenarioSyncStatus,
  getScenarioSyncStatus,
  getScenarioSyncStatusBatch,
  clearScenarioSyncStatus,
  recordFirestoreBatchSuccess,
  recordFirestoreBatchFailure,
  isFirestoreCircuitOpen,
  resetCircuitForTests,
};
