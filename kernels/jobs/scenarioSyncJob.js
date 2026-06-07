const appMetrics = require("../metrics/appMetrics");
const { logWarn, logInfo } = require("../logging/appLogger");
const { runScheduledWorkWithLease } = require("./redisJobLease");
const { processPendingJobs } = require("../../modules/config/services/scenarioSyncJobService");
const { getSchedulerClient } = require("../redis/redisClients");

const LOCK_KEY = "lock:scenario_sync_job";
const LOCK_TTL_MS = 4 * 60 * 1000;

const LATENCY_METRIC_BASE = "sync_jobs_batch_process";

function getRedisClient() {
  return getSchedulerClient();
}

function intervalMs() {
  const minutes = parseInt(process.env.SCENARIO_SYNC_INTERVAL_MINUTES || "5", 10);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
  return safeMinutes * 60 * 1000;
}

async function runOnce() {
  try {
    await runScheduledWorkWithLease(
      {
        getRedis: getRedisClient,
        lockKey: LOCK_KEY,
        lockTtlMs: LOCK_TTL_MS,
        logLabel: "scenario-sync",
      },
      async () => {
        const started = Date.now();
        try {
          const result = await processPendingJobs();
          appMetrics.inc("scenario_sync_batches_total");
          appMetrics.inc("scenario_sync_jobs_scanned_total", result.scanned || 0);
          appMetrics.inc("scenario_sync_jobs_succeeded_total", result.succeeded || 0);
          appMetrics.inc("scenario_sync_jobs_failed_total", result.failed || 0);
          if ((result.failed || 0) > 0) {
            appMetrics.inc("sync_jobs_batch_runs_with_job_failures_total");
          }
          if (result.succeeded > 0 || result.failed > 0) {
            logInfo("[scenario-sync] batch complete", {
              scanned: result.scanned,
              succeeded: result.succeeded,
              failed: result.failed,
            });
          }
        } finally {
          const elapsed = Date.now() - started;
          appMetrics.recordLatency(LATENCY_METRIC_BASE, elapsed);

          const budgetMs = parseInt(process.env.SYNC_JOB_BATCH_BUDGET_MS || "0", 10);
          if (Number.isFinite(budgetMs) && budgetMs > 0 && elapsed > budgetMs) {
            appMetrics.inc("sync_jobs_batch_budget_violations_total");
            logWarn("[scenario-sync] vượt ngưỡng thời gian batch SyncJobs", {
              elapsed_ms: elapsed,
              budget_ms: budgetMs,
            });
          }
        }
      }
    );
  } catch (error) {
    appMetrics.inc("scenario_sync_executor_errors_total");
    logWarn("[scenario-sync] executor failed", { message: error.message || String(error) });
  }
}

function startScenarioSyncJob() {
  if (process.env.SCENARIO_SYNC_ENABLED === "false") return;
  if (process.env.NODE_ENV === "test" || process.env.CI === "true") return;

  runOnce();
  const timer = setInterval(runOnce, intervalMs());
  if (typeof timer.unref === "function") timer.unref();
}

module.exports = { startScenarioSyncJob, runOnce };
