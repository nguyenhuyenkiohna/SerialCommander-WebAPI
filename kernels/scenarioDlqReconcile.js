/**
 * Hòa giải DLQ outbox: MySQL là source of truth — đọc lại Content và re-enqueue.
 */
const { Scenario } = require("../models");
const { logInfo, logWarn } = require("./logging/appLogger");
const scenarioSyncQueue = require("./scenarioSyncQueue");
const scenarioSyncStatus = require("./scenarioSyncStatus");

function parseContentFromRow(row) {
  if (!row?.Content) return [];
  try {
    const parsed = JSON.parse(row.Content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {{ raw: string, parsed: object|null }} entry
 * @returns {Promise<{ outcome: string, scenarioId?: string }>}
 */
async function reconcileDlqItem(entry) {
  const { raw, parsed } = entry;
  if (!parsed?.scenarioId || !parsed?.action) {
    await scenarioSyncQueue.removeFromDlq(raw);
    return { outcome: "discarded_invalid" };
  }

  const { scenarioId, action } = parsed;

  if (action === scenarioSyncQueue.ACTIONS.DELETE_FIRESTORE) {
    const exists = await Scenario.findByPk(scenarioId);
    await scenarioSyncQueue.removeFromDlq(raw);
    if (!exists) {
      await scenarioSyncStatus.setScenarioSyncStatus(scenarioId, "success");
      return { outcome: "delete_confirmed", scenarioId };
    }
    await scenarioSyncQueue.enqueueDelete(scenarioId);
    return { outcome: "delete_requeued", scenarioId };
  }

  if (action === scenarioSyncQueue.ACTIONS.SYNC_FIRESTORE) {
    const row = await Scenario.findByPk(scenarioId);
    await scenarioSyncQueue.removeFromDlq(raw);
    if (!row) {
      await scenarioSyncQueue.enqueueDelete(scenarioId);
      return { outcome: "upsert_missing_mysql_enqueue_delete", scenarioId };
    }
    const content = parseContentFromRow(row);
    await scenarioSyncQueue.enqueueSync(scenarioId, content);
    await scenarioSyncStatus.setScenarioSyncStatus(scenarioId, "pending");
    return { outcome: "upsert_requeued_from_mysql", scenarioId };
  }

  await scenarioSyncQueue.removeFromDlq(raw);
  return { outcome: "discarded_unknown_action", scenarioId };
}

/**
 * @param {number} [maxItems]
 * @returns {Promise<Array<{ outcome: string, scenarioId?: string, error?: string }>>}
 */
async function reconcileDlqBatch(maxItems = 10) {
  const entries = await scenarioSyncQueue.peekDlq(maxItems);
  if (!entries.length) return [];

  const results = [];
  for (const entry of entries) {
    try {
      const result = await reconcileDlqItem(entry);
      results.push(result);
      logInfo("[dlq-reconcile] processed", result);
    } catch (err) {
      logWarn("[dlq-reconcile] item failed", {
        scenarioId: entry.parsed?.scenarioId,
        message: err.message || String(err),
      });
      results.push({
        scenarioId: entry.parsed?.scenarioId,
        outcome: "error",
        error: err.message || String(err),
      });
    }
  }
  return results;
}

module.exports = {
  reconcileDlqItem,
  reconcileDlqBatch,
  parseContentFromRow,
};
