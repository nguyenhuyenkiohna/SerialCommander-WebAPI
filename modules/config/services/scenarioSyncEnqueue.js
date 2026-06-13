"use strict";

/**
 * Điểm enqueue duy nhất cho đồng bộ nội dung kịch bản → Firestore.
 * Luồng chuẩn: Redis outbox (kernels/scenarioSyncQueue + syncJob worker).
 */
const { logError } = require("../../../kernels/logging/appLogger");
const scenarioSyncQueue = require("../../../kernels/scenarioSyncQueue");

/**
 * @param {"scenario_upsert"|"scenario_delete"} operationType
 * @param {string} scenarioId
 * @param {{ content?: unknown[] }|null} payload
 * @param {{ transaction?: import("sequelize").Transaction }} [options]
 */
async function enqueueScenarioFirestoreSync(operationType, scenarioId, payload, options = {}) {
  if (options.transaction) {
    const err = new Error(
      "Redis outbox không hỗ trợ enqueue trong MySQL transaction — gọi sau commit."
    );
    err.code = "SCENARIO_SYNC_ENQUEUE_IN_TX";
    throw err;
  }

  try {
    if (operationType === "scenario_delete") {
      await scenarioSyncQueue.enqueueDelete(scenarioId);
      return;
    }
    if (operationType === "scenario_upsert") {
      await scenarioSyncQueue.enqueueSync(scenarioId, payload?.content || []);
      return;
    }
    throw new Error(`Unsupported sync operation: ${operationType}`);
  } catch (error) {
    logError("enqueueScenarioFirestoreSync failed", {
      operationType,
      scenarioId,
      message: error.message || String(error),
      code: error.code,
    });
    throw error;
  }
}

module.exports = {
  enqueueScenarioFirestoreSync,
};
