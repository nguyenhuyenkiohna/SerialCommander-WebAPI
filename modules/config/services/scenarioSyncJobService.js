const crypto = require("crypto");
const { Op, col, where } = require("sequelize");
const { SyncJob } = require("../../../models");
const scenarioFirestore = require("./scenarioFirestoreService");

const STATUS = {
  pending: "pending",
  processing: "processing",
  success: "success",
  failed: "failed",
};

function contentHash(contentArray) {
  const body = JSON.stringify(Array.isArray(contentArray) ? contentArray : []);
  return crypto.createHash("sha256").update(body).digest("hex").slice(0, 24);
}

function buildOperationKey(operationType, scenarioId, payload) {
  if (operationType === "scenario_delete") return `scenario_delete:${scenarioId}`;
  if (operationType === "scenario_upsert") {
    return `scenario_upsert:${scenarioId}:${contentHash(payload?.content)}`;
  }
  return `${operationType}:${scenarioId}:${Date.now()}`;
}

function nextRetryDate(retryCount) {
  const backoffSeconds = Math.min(300, Math.pow(2, Math.max(0, retryCount)) * 5);
  return new Date(Date.now() + backoffSeconds * 1000);
}

function parseJobPayload(payloadText) {
  if (payloadText == null || payloadText === "") {
    return null;
  }
  try {
    return JSON.parse(payloadText);
  } catch (e) {
    const err = new Error(`Payload SyncJob JSON không hợp lệ: ${e.message}`);
    err.code = "SYNC_JOB_PAYLOAD_INVALID";
    throw err;
  }
}

function buildPendingSyncJobsWhere(now) {
  return {
    [Op.and]: [
      {
        [Op.or]: [
          { Status: STATUS.pending },
          {
            [Op.and]: [
              { Status: STATUS.failed },
              where(col("RetryCount"), Op.lt, col("MaxRetries")),
            ],
          },
        ],
      },
      {
        [Op.or]: [{ NextRetryAt: null }, { NextRetryAt: { [Op.lte]: now } }],
      },
    ],
  };
}

async function enqueue(operationType, scenarioId, payload, errorMessage, options = {}) {
  const operationKey = buildOperationKey(operationType, scenarioId, payload);
  try {
    await SyncJob.create({
      OperationType: operationType,
      OperationKey: operationKey,
      ScenarioId: scenarioId,
      Payload: payload ? JSON.stringify(payload) : null,
      Status: STATUS.pending,
      RetryCount: 0,
      MaxRetries: 10,
      NextRetryAt: new Date(),
      LastError: errorMessage || null,
    }, options);
  } catch (error) {
    // duplicate operation key means identical job already enqueued/succeeded.
    if (
      error.name !== "SequelizeUniqueConstraintError" &&
      error.original?.code !== "ER_DUP_ENTRY"
    ) {
      throw error;
    }
  }
}

async function executeJob(job) {
  const payload = parseJobPayload(job.Payload);
  if (job.OperationType === "scenario_upsert") {
    await scenarioFirestore.saveScenarioContent(job.ScenarioId, payload?.content || []);
    return;
  }
  if (job.OperationType === "scenario_delete") {
    await scenarioFirestore.deleteScenarioContent(job.ScenarioId);
    return;
  }
  throw new Error(`Unsupported sync operation: ${job.OperationType}`);
}

async function processPendingJobs(limit = 20, workerId) {
  const sequelize = SyncJob.sequelize;
  const now = new Date();
  const currentWorkerId = workerId || crypto.randomUUID();

  // 0. Stale recovery: reset jobs bị stuck ở processing (worker crash) về pending
  await sequelize.query(
    `UPDATE SyncJobs
     SET Status = 'pending', WorkerId = NULL, ModifiedAt = UTC_TIMESTAMP()
     WHERE Status = 'processing' AND WorkerId IS NOT NULL AND ModifiedAt < UTC_TIMESTAMP() - INTERVAL 30 MINUTE`,
    { type: sequelize.QueryTypes.UPDATE }
  );

  // 1. Claim jobs atomically cho worker này — chỉ jobs của worker này được fetch ở bước 2
  const nowIso = now.toISOString().slice(0, 19).replace("T", " ");
  await sequelize.query(
    `UPDATE SyncJobs
     SET Status = 'processing', WorkerId = :workerId, ModifiedAt = UTC_TIMESTAMP()
     WHERE (Status = 'pending' OR (Status = 'failed' AND RetryCount < MaxRetries))
       AND (NextRetryAt IS NULL OR NextRetryAt <= :now)
     ORDER BY CreatedAt ASC
     LIMIT :limit`,
    {
      replacements: { now: nowIso, limit: limit, workerId: currentWorkerId },
      type: sequelize.QueryTypes.UPDATE,
    }
  );

  // 2. Chỉ lấy jobs được claim bởi worker này — tránh double-execution khi multi-replica
  const jobs = await SyncJob.findAll({
    where: { Status: STATUS.processing, WorkerId: currentWorkerId },
    order: [["CreatedAt", "ASC"]],
  });

  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await executeJob(job);
      await job.update({
        Status: STATUS.success,
        WorkerId: null,
        LastError: null,
        NextRetryAt: null,
      });
      succeeded += 1;
    } catch (error) {
      const retryCount = (job.RetryCount || 0) + 1;
      try {
        await job.update({
          Status: STATUS.failed,
          WorkerId: null,
          RetryCount: retryCount,
          LastError: String(error.message || error),
          NextRetryAt: nextRetryDate(retryCount),
        });
      } catch (updateError) {
        // Log nhưng không để lỗi DB update phá vỡ vòng lặp xử lý các job còn lại.
        const { logWarn } = require("../../../kernels/logging/appLogger");
        logWarn("[sync-job] Không cập nhật được trạng thái failed cho job", {
          jobId: job.id,
          message: updateError.message || String(updateError),
        });
      }
      failed += 1;
    }
  }

  return { scanned: jobs.length, succeeded, failed, workerId: currentWorkerId };
}

module.exports = {
  enqueue,
  processPendingJobs,
  buildPendingSyncJobsWhere,
};
