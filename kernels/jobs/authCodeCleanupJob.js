const { cleanupExpiredAuthCodes } = require("../../modules/auth/services/authDomainService");
const { logWarn, logInfo } = require("../logging/appLogger");
const { runScheduledWorkWithLease } = require("./redisJobLease");
const { getAuthCleanupClient } = require("../redis/redisClients");

const LOCK_KEY = "lock:auth_code_cleanup";
const LOCK_TTL_MS = 55 * 60 * 1000;

function getRedisClient() {
  return getAuthCleanupClient();
}

function intervalMs() {
  const minutes = parseInt(process.env.AUTH_CODE_CLEANUP_INTERVAL_MINUTES || "60", 10);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
  return safeMinutes * 60 * 1000;
}

async function runOnce() {
  try {
    await runScheduledWorkWithLease(
      {
        getRedis: getRedisClient,
        lockKey: LOCK_KEY,
        lockTtlMs: LOCK_TTL_MS,
        logLabel: "auth-cleanup",
      },
      async () => {
        const result = await cleanupExpiredAuthCodes();
        const totalDeleted =
          (result.deletedExpiredVerification || 0) +
          (result.deletedExpiredReset || 0) +
          (result.deletedUsedVerification || 0) +
          (result.deletedUsedReset || 0);
        if (totalDeleted > 0) {
          logInfo("[auth-cleanup] deleted expired codes", {
            expired_verification: result.deletedExpiredVerification,
            expired_reset: result.deletedExpiredReset,
            used_verification: result.deletedUsedVerification,
            used_reset: result.deletedUsedReset,
            retention_days: result.retentionDays,
            total_deleted: totalDeleted,
          });
        }
      }
    );
  } catch (error) {
    logWarn("[auth-cleanup] failed", { message: error.message || String(error) });
  }
}

function startAuthCodeCleanupJob() {
  if (process.env.AUTH_CODE_CLEANUP_ENABLED === "false") {
    return;
  }
  if (process.env.NODE_ENV === "test" || process.env.CI === "true") {
    return;
  }
  runOnce();
  const timer = setInterval(runOnce, intervalMs());
  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

module.exports = { startAuthCodeCleanupJob, runOnce };
