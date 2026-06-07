/**
 * Chạy scheduler an toàn đa replica: ưu tiên lock Redis (NX + TTL).
 *
 * - Không Redis: vẫn chạy body (phù hợp 1 instance). Trên production có thể **bắt buộc** Redis.
 * - SCHEDULER_STRICT_REPLICA_MODE=true (và NODE_ENV=production): thiếu Redis → không chạy body (tránh chạy song song nhiều pod).
 */

const { logWarn } = require("../logging/appLogger");

function isStrictReplicaScheduler() {
  const strict =
    process.env.SCHEDULER_STRICT_REPLICA_MODE === "true" ||
    process.env.JOB_SCHEDULER_REQUIRE_REDIS === "true";
  return strict && process.env.NODE_ENV === "production";
}

/**
 * @param {object} opts
 * @param {() => import("ioredis").default | null | undefined} opts.getRedis factory trả client hoặc null
 * @param {string} opts.lockKey
 * @param {number} opts.lockTtlMs
 * @param {string} opts.logLabel
 * @param {(info: { skippedNoRedis?: boolean; skippedLock?: boolean }) => Promise<void>} worker
 * @returns {Promise<{ ran: boolean; skippedNoRedis?: boolean; skippedLock?: boolean }>}
 */
async function ensureRedisConnected(redis) {
  if (!redis) return false;
  if (!redis.status || redis.status === "ready") return true;
  if (typeof redis.connect !== "function") return true;

  if (redis.status === "connecting") {
    await new Promise((resolve, reject) => {
      const onReady = () => {
        redis.removeListener("error", onError);
        resolve(undefined);
      };
      const onError = (err) => {
        redis.removeListener("ready", onReady);
        reject(err);
      };
      redis.once("ready", onReady);
      redis.once("error", onError);
    });
    return true;
  }

  await redis.connect();
  return true;
}

async function runScheduledWorkWithLease(opts, worker) {
  const { getRedis, lockKey, lockTtlMs, logLabel } = opts;
  const redis = typeof getRedis === "function" ? getRedis() : null;

  if (!redis && isStrictReplicaScheduler()) {
    logWarn(`[${logLabel}] skip: strict replica mode cần Redis lock (thiếu URL kết nối).`, {});
    return { ran: false, skippedNoRedis: true };
  }

  let lockValue;
  let acquiredLock = false;
  let redisUsable = false;
  try {
    if (redis) {
      try {
        redisUsable = await ensureRedisConnected(redis);
      } catch (connectErr) {
        logWarn(`[${logLabel}] Redis chưa sẵn sàng — chạy không lock (dev/single instance).`, {
          message: connectErr.message || String(connectErr),
        });
        redisUsable = false;
      }
    }

    if (redis && redisUsable) {
      lockValue = `${process.pid}-${Date.now()}`;
      const lockResult = await redis.set(lockKey, lockValue, "PX", lockTtlMs, "NX");
      acquiredLock = lockResult === "OK";
      if (!acquiredLock) {
        return { ran: false, skippedLock: true };
      }
    }

    await worker({ skippedNoRedis: false, skippedLock: false });
    return { ran: true };
  } finally {
    if (redis && redisUsable && acquiredLock && lockValue) {
      try {
        const currentValue = await redis.get(lockKey);
        if (currentValue === lockValue) {
          await redis.del(lockKey);
        }
      } catch (unlockError) {
        logWarn(`[${logLabel}] unlock failed`, { message: unlockError.message });
      }
    }
  }
}

module.exports = {
  runScheduledWorkWithLease,
  isStrictReplicaScheduler,
};
