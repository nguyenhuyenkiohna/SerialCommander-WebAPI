const { logWarn } = require("./logging/appLogger");
const { getOutboxClient } = require("./redis/redisClients");

const QUEUE_KEY = "queue:scenario_sync";
const PROCESSING_KEY = "queue:scenario_sync:processing";
const DLQ_KEY = "queue:scenario_sync:dlq";
const OUTBOX_LOCK_KEY = "sync:lock";
const OUTBOX_LOCK_TTL_SEC = 10;
const MAX_RETRY_COUNT = 5;

const ACTIONS = {
  SYNC_FIRESTORE: "SYNC_FIRESTORE",
  DELETE_FIRESTORE: "DELETE_FIRESTORE",
};

function getRedisClient() {
  return getOutboxClient();
}

function buildMessage(payload) {
  return JSON.stringify({
    ...payload,
    retryCount: payload.retryCount || 0,
    enqueuedAt: new Date().toISOString(),
  });
}

function parseMessage(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.scenarioId || !parsed?.action) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function ensureRedisReady() {
  const client = getRedisClient();
  if (!client) {
    const err = new Error(
      "Redis outbox chưa cấu hình (SCENARIO_OUTBOX_REDIS_URL hoặc SCENARIO_SYNC_REDIS_URL)."
    );
    err.statusCode = 503;
    err.code = "SCENARIO_OUTBOX_REDIS_UNAVAILABLE";
    throw err;
  }
  if (client.status !== "ready") {
    await client.connect();
  }
  return client;
}

/**
 * @param {{ scenarioId: string, content?: unknown[], action: string }} payload
 */
async function enqueue(payload) {
  try {
    const client = await ensureRedisReady();
    await client.lpush(QUEUE_KEY, buildMessage(payload));
  } catch (err) {
    const wrapped = new Error("Redis outbox enqueue failed");
    wrapped.statusCode = 503;
    wrapped.code = "SCENARIO_OUTBOX_ENQUEUE_FAILED";
    wrapped.cause = err;
    throw wrapped;
  }
}

async function enqueueSync(scenarioId, content) {
  return enqueue({
    scenarioId,
    content: Array.isArray(content) ? content : [],
    action: ACTIONS.SYNC_FIRESTORE,
  });
}

async function enqueueDelete(scenarioId) {
  return enqueue({
    scenarioId,
    action: ACTIONS.DELETE_FIRESTORE,
  });
}

/**
 * Claim batch: RPOPLPUSH → processing (chưa xóa khỏi hệ thống).
 * @returns {Promise<{ items: object[], raws: string[] }>}
 */
async function claimBatch(maxItems = 10) {
  const client = await ensureRedisReady();
  const items = [];
  const raws = [];
  const limit = Math.max(1, Math.min(maxItems, 50));

  for (let i = 0; i < limit; i += 1) {
    const raw = await client.rpoplpush(QUEUE_KEY, PROCESSING_KEY);
    if (!raw) break;
    raws.push(raw);
    const parsed = parseMessage(raw);
    if (parsed) items.push(parsed);
  }
  return { items, raws };
}

/** Xóa job khỏi processing sau khi Firestore thành công. */
async function ackBatch(raws = []) {
  if (!raws.length) return;
  const client = await ensureRedisReady();
  for (const raw of raws) {
    await client.lrem(PROCESSING_KEY, 1, raw);
  }
}

/**
 * Firestore lỗi — đưa job về queue chính, hoặc DLQ nếu đã vượt MAX_RETRY_COUNT.
 * Job trong DLQ không được xử lý tự động, cần can thiệp thủ công.
 */
async function requeueBatch(raws = []) {
  if (!raws.length) return;
  const client = await ensureRedisReady();
  for (const raw of raws) {
    await client.lrem(PROCESSING_KEY, 1, raw);
    const parsed = parseMessage(raw);
    const currentRetry = parsed?.retryCount || 0;
    if (currentRetry >= MAX_RETRY_COUNT) {
      await client.lpush(DLQ_KEY, raw);
      logWarn("[scenario-sync-queue] job moved to DLQ after max retries", {
        scenarioId: parsed?.scenarioId,
        action: parsed?.action,
        retryCount: currentRetry,
        maxRetries: MAX_RETRY_COUNT,
      });
    } else {
      const updatedRaw = JSON.stringify({ ...parsed, retryCount: currentRetry + 1 });
      await client.lpush(QUEUE_KEY, updatedRaw);
    }
  }
}

/** SET sync:lock … NX — chỉ một replica worker. */
async function acquireOutboxLock() {
  const client = getRedisClient();
  if (!client) return true;
  if (client.status !== "ready") {
    try {
      await client.connect();
    } catch {
      return false;
    }
  }
  const ok = await client.set(OUTBOX_LOCK_KEY, "1", "EX", OUTBOX_LOCK_TTL_SEC, "NX");
  return ok === "OK";
}

async function releaseOutboxLock() {
  const client = getRedisClient();
  if (!client || client.status !== "ready") return;
  try {
    await client.del(OUTBOX_LOCK_KEY);
  } catch {
    /* noop */
  }
}

/** @deprecated Dùng claimBatch + ackBatch */
async function dequeueBatch(maxItems = 10) {
  const { items } = await claimBatch(maxItems);
  return items;
}

module.exports = {
  QUEUE_KEY,
  PROCESSING_KEY,
  DLQ_KEY,
  OUTBOX_LOCK_KEY,
  MAX_RETRY_COUNT,
  ACTIONS,
  enqueue,
  enqueueSync,
  enqueueDelete,
  claimBatch,
  ackBatch,
  requeueBatch,
  acquireOutboxLock,
  releaseOutboxLock,
  dequeueBatch,
  parseMessage,
  getRedisClient,
};
