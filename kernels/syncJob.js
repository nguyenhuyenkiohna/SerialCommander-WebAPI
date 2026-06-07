/**
 * Worker Outbox: claim → Firestore → ack (hoặc requeue khi lỗi).
 */
const appMetrics = require("./metrics/appMetrics");
const { logWarn, logInfo } = require("./logging/appLogger");
const scenarioSyncQueue = require("./scenarioSyncQueue");
const scenarioFirestore = require("../modules/config/services/scenarioFirestoreService");

const POLL_MS = Number(process.env.SCENARIO_OUTBOX_POLL_MS || 1000);
const BATCH_SIZE = Number(process.env.SCENARIO_OUTBOX_BATCH_SIZE || 10);
const MAX_RETRY_DELAY_MS = Number(process.env.SCENARIO_OUTBOX_MAX_RETRY_MS || 30000);

let pollTimer = null;
let processing = false;
let consecutiveFailureCount = 0;
let retryBlockedUntil = 0;

function computeRetryDelayMs(failureCount) {
  const failures = Math.max(1, failureCount);
  return Math.min(MAX_RETRY_DELAY_MS, Math.pow(2, failures - 1) * POLL_MS);
}

function resetBackoffState() {
  consecutiveFailureCount = 0;
  retryBlockedUntil = 0;
}

function isBackoffActive(now = Date.now()) {
  return retryBlockedUntil > now;
}

async function processQueueBatch() {
  if (processing) return;
  if (isBackoffActive()) return;
  processing = true;
  let hasLock = false;
  const started = Date.now();
  let claimedRaws = [];

  try {
    hasLock = await scenarioSyncQueue.acquireOutboxLock();
    if (!hasLock) return;

    const { items, raws } = await scenarioSyncQueue.claimBatch(BATCH_SIZE);
    claimedRaws = raws;
    if (!items.length) return;

    const upserts = [];
    const deletes = [];

    for (const item of items) {
      if (item.action === scenarioSyncQueue.ACTIONS.SYNC_FIRESTORE) {
        upserts.push({
          scenarioId: item.scenarioId,
          content: Array.isArray(item.content) ? item.content : [],
        });
      } else if (item.action === scenarioSyncQueue.ACTIONS.DELETE_FIRESTORE) {
        deletes.push(item.scenarioId);
      } else {
        logWarn("[syncJob] Bỏ qua action không hỗ trợ", { action: item.action });
      }
    }

    if (upserts.length > 0) {
      await scenarioFirestore.batchSaveScenarioContent(upserts);
      appMetrics.inc("scenario_outbox_upserts_total", upserts.length);
    }
    if (deletes.length > 0) {
      await scenarioFirestore.batchDeleteScenarioContent(deletes);
      appMetrics.inc("scenario_outbox_deletes_total", deletes.length);
    }

    await scenarioSyncQueue.ackBatch(claimedRaws);
    claimedRaws = [];
    resetBackoffState();

    appMetrics.inc("scenario_outbox_batches_total");
    logInfo("[syncJob] batch processed", {
      upserts: upserts.length,
      deletes: deletes.length,
      elapsed_ms: Date.now() - started,
    });
  } catch (error) {
    consecutiveFailureCount += 1;
    const delayMs = computeRetryDelayMs(consecutiveFailureCount);
    retryBlockedUntil = Date.now() + delayMs;
    appMetrics.inc("scenario_outbox_batch_errors_total");
    logWarn("[syncJob] batch failed — requeue", {
      message: error.message || String(error),
      retry_in_ms: delayMs,
      consecutive_failures: consecutiveFailureCount,
    });
    if (claimedRaws.length > 0) {
      await scenarioSyncQueue.requeueBatch(claimedRaws).catch((requeueErr) => {
        logWarn("[syncJob] requeue failed", { message: requeueErr.message || String(requeueErr) });
      });
      claimedRaws = [];
    }
  } finally {
    if (hasLock) {
      await scenarioSyncQueue.releaseOutboxLock();
    }
    processing = false;
  }
}

function startScenarioOutboxWorker() {
  if (process.env.SCENARIO_OUTBOX_WORKER_ENABLED === "false") return;
  if (process.env.NODE_ENV === "test" || process.env.CI === "true") return;

  processQueueBatch();
  pollTimer = setInterval(() => {
    processQueueBatch();
  }, POLL_MS);

  if (typeof pollTimer.unref === "function") {
    pollTimer.unref();
  }

  logInfo("[syncJob] Outbox worker started", { poll_ms: POLL_MS, batch_size: BATCH_SIZE });
}

function stopScenarioOutboxWorker() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = {
  startScenarioOutboxWorker,
  stopScenarioOutboxWorker,
  processQueueBatch,
  __private: {
    computeRetryDelayMs,
    resetBackoffState,
    getBackoffState: () => ({
      consecutiveFailureCount,
      retryBlockedUntil,
    }),
  },
};
