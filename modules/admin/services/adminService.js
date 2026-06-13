const appMetrics = require("../../../kernels/metrics/appMetrics");
const scenarioSyncQueue = require("../../../kernels/scenarioSyncQueue");
const { reconcileDlqBatch } = require("../../../kernels/scenarioDlqReconcile");
const { Scenario } = require("../../../models");

exports.getSharedConfigs = async () => {
  return await Scenario.findAll({ where: { IsShared: true } });
};

exports.deleteSharedConfig = async (id) => {
  const config = await Scenario.findByPk(id);
  if (!config || !config.IsShared) {
    throw new Error("Không tìm thấy cấu hình chia sẻ");
  }
  await config.destroy();
  return config;
};

exports.approveSharedConfig = async (id) => {
  const config = await Scenario.findByPk(id);
  if (!config) {
    throw new Error("Không tìm thấy cấu hình");
  }
  await config.update({ IsShared: true });
  return config;
};

/**
 * Bảng điều khiển vận hành: trạng thái Redis outbox (queue / processing / DLQ).
 * Giữ tên hàm/API cũ (sync-jobs) để không gãy dashboard — dữ liệu từ outbox thay vì bảng SyncJobs.
 */
exports.getSyncJobsOpsSummary = async () => {
  const lengths = await scenarioSyncQueue.getQueueLengths();
  const dlqEntries = await scenarioSyncQueue.peekDlq(20);

  const by_status = {
    pending: lengths.queue,
    processing: lengths.processing,
    failed: lengths.dlq,
  };

  return {
    generated_at: new Date().toISOString(),
    source: "redis_outbox",
    by_status,
    due_for_processing: lengths.queue,
    failed_recent: dlqEntries
      .filter((e) => e.parsed)
      .map((e) => ({
        id: e.raw.slice(0, 32),
        operation_type: e.parsed.action,
        scenario_id: e.parsed.scenarioId,
        retry_count: e.parsed.retryCount || 0,
        last_error: "max_retries_exceeded",
        modified_at: e.parsed.enqueuedAt || null,
      })),
    queue_lengths: lengths,
  };
};

/**
 * Chạy reconciliation DLQ thủ công (admin): đọc MySQL → re-enqueue.
 * @param {number} [maxItems]
 */
exports.reconcileScenarioOutboxDlq = async (maxItems = 20) => {
  const before = await scenarioSyncQueue.getQueueLengths();
  const results = await reconcileDlqBatch(maxItems);
  const after = await scenarioSyncQueue.getQueueLengths();
  return {
    generated_at: new Date().toISOString(),
    processed: results.length,
    results,
    queue_lengths_before: before,
    queue_lengths_after: after,
  };
};

/**
 * Counters in-process + gauge từ Redis outbox (scraping Prometheus / Grafana).
 */
exports.getOpsAppMetrics = async () => {
  const lengths = await scenarioSyncQueue.getQueueLengths();

  const gauges = {
    sync_jobs_due_for_processing: lengths.queue,
    sync_jobs_pending: lengths.queue,
    sync_jobs_processing: lengths.processing,
    sync_jobs_failed: lengths.dlq,
    scenario_outbox_queue: lengths.queue,
    scenario_outbox_processing: lengths.processing,
    scenario_outbox_dlq: lengths.dlq,
  };

  Object.assign(gauges, appMetrics.getLatencyGaugeSnapshot());

  return {
    generated_at: new Date().toISOString(),
    counters: appMetrics.getCountersSnapshot(),
    gauges,
  };
};
