const { QueryTypes } = require("sequelize");
const appMetrics = require("../../../kernels/metrics/appMetrics");
const { Scenario, SyncJob } = require("../../../models");

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
 * Bảng điều khiển vận hành: trạng thái hàng đợi đồng bộ MySQL ↔ Firestore (SyncJobs).
 */
exports.getSyncJobsOpsSummary = async () => {
  const sequelize = SyncJob.sequelize;

  const byStatusRows = await sequelize.query(
    `SELECT Status AS status, COUNT(*) AS cnt FROM SyncJobs GROUP BY Status ORDER BY Status`,
    { type: QueryTypes.SELECT }
  );

  const dueRows = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM SyncJobs WHERE Status IN ('pending','failed') AND (NextRetryAt IS NULL OR NextRetryAt <= UTC_TIMESTAMP())`,
    { type: QueryTypes.SELECT }
  );

  const failedRecent = await sequelize.query(
    `SELECT Id, OperationType, ScenarioId, RetryCount, LastError, ModifiedAt
     FROM SyncJobs WHERE Status = 'failed' ORDER BY ModifiedAt DESC LIMIT 20`,
    { type: QueryTypes.SELECT }
  );

  const by_status = {};
  for (const row of byStatusRows) {
    by_status[row.status] = Number(row.cnt);
  }

  return {
    generated_at: new Date().toISOString(),
    by_status,
    due_for_processing: Number(dueRows[0]?.cnt ?? 0),
    failed_recent: failedRecent.map((r) => ({
      id: String(r.Id),
      operation_type: r.OperationType,
      scenario_id: r.ScenarioId,
      retry_count: r.RetryCount,
      last_error: r.LastError || null,
      modified_at: r.ModifiedAt ? new Date(r.ModifiedAt).toISOString() : null,
    })),
  };
};

/**
 * Counters in-process + gauge từ bảng SyncJobs (scraping Prometheus / Grafana).
 */
exports.getOpsAppMetrics = async () => {
  const sequelize = SyncJob.sequelize;
  const byStatusRows = await sequelize.query(
    `SELECT Status AS status, COUNT(*) AS cnt FROM SyncJobs GROUP BY Status`,
    { type: QueryTypes.SELECT }
  );
  const dueRows = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM SyncJobs WHERE Status IN ('pending','failed') AND (NextRetryAt IS NULL OR NextRetryAt <= UTC_TIMESTAMP())`,
    { type: QueryTypes.SELECT }
  );

  const gauges = {
    sync_jobs_due_for_processing: Number(dueRows[0]?.cnt ?? 0),
  };
  for (const row of byStatusRows) {
    gauges[`sync_jobs_${row.status}`] = Number(row.cnt);
  }

  Object.assign(gauges, appMetrics.getLatencyGaugeSnapshot());

  return {
    generated_at: new Date().toISOString(),
    counters: appMetrics.getCountersSnapshot(),
    gauges,
  };
};
