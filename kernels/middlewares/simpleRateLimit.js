const { sendError } = require("./errorHandler");
const appMetrics = require("../metrics/appMetrics");
const { logWarn } = require("../logging/appLogger");
const { createRedisClient } = require("../redis/redisClientFactory");

const RL_429_COUNTER = "http_rate_limit_429_total";

/** In-memory fallback — chỉ đúng khi chạy 1 instance. */
const memoryBuckets = new Map();

let rateLimitRedis = null;
let storeMode = "memory";
let noRedisUrlWarned = false;
let memoryFallbackWarned = false;

function getRateLimitRedisUrl() {
  return (
    process.env.RATE_LIMIT_REDIS_URL ||
    process.env.SCHEDULER_SHARED_REDIS_URL ||
    process.env.SCENARIO_OUTBOX_REDIS_URL
  );
}

function initRateLimitRedis() {
  if (rateLimitRedis !== null) {
    return rateLimitRedis;
  }

  const url = getRateLimitRedisUrl();
  if (!url) {
    storeMode = "memory";
    if (process.env.NODE_ENV === "production" && !noRedisUrlWarned) {
      logWarn(
        "[rate-limit] RATE_LIMIT_REDIS_URL chưa cấu hình — đang dùng in-memory. Scale ngang sẽ không chia sẻ giới hạn giữa các replica.",
        { code: "RATE_LIMIT_NO_REDIS_URL" }
      );
      noRedisUrlWarned = true;
    }
    rateLimitRedis = null;
    return null;
  }

  const { client, mode } = createRedisClient({ url, label: "rate-limit" });
  if (client) {
    storeMode = "redis";
    rateLimitRedis = client;
    return client;
  }

  storeMode = "memory";
  if (!memoryFallbackWarned) {
    logWarn(
      "[rate-limit] Không khởi tạo được Redis client — fallback in-memory.",
      { code: "RATE_LIMIT_REDIS_INIT_FAILED" }
    );
    memoryFallbackWarned = true;
  }
  rateLimitRedis = null;
  return null;
}

function parseClientIp(req) {
  // Dùng req.ip thay vì đọc X-Forwarded-For trực tiếp.
  // req.ip đã được Express xử lý dựa theo trust proxy setting — tránh client giả mạo XFF.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * Tạo rate limit key: ưu tiên per-user (sau authn) để chặn abuse từ cùng account;
 * fallback per-IP cho routes public.
 */
function buildRateLimitKey(req) {
  const userId = req.user?.id || req.user?.userId;
  if (userId) return `rl:${req.path}:user:${userId}`;
  return `rl:${req.path}:ip:${parseClientIp(req)}`;
}

async function checkRedisLimit({ key, windowMs, maxRequests }) {
  const client = initRateLimitRedis();
  if (!client) {
    return null;
  }

  try {
    if (client.status !== "ready") {
      await client.connect();
    }
    const count = await client.incr(key);
    if (count === 1) {
      await client.pexpire(key, windowMs);
    }
    const ttlMs = await client.pttl(key);
    return { count, ttlMs, store: "redis" };
  } catch (err) {
    if (!memoryFallbackWarned) {
      logWarn(
        "[rate-limit] Redis INCR thất bại — fallback in-memory cho request này và các request sau (đến khi Redis hồi phục).",
        { code: "RATE_LIMIT_REDIS_OP_FAILED", message: err.message || String(err) }
      );
      memoryFallbackWarned = true;
    }
    storeMode = "memory";
    return null;
  }
}

function checkMemoryLimit({ key, windowMs, maxRequests }) {
  const now = Date.now();
  const current = memoryBuckets.get(key);

  if (!current || now > current.resetAt) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, ttlMs: windowMs, store: "memory" };
  }

  if (current.count >= maxRequests) {
    return {
      allowed: false,
      ttlMs: Math.max(0, current.resetAt - now),
      store: "memory",
    };
  }

  current.count += 1;
  return { allowed: true, ttlMs: current.resetAt - now, store: "memory" };
}

function sendRateLimitResponse(res, ttlMs) {
  if (ttlMs > 0) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(ttlMs / 1000))));
  }
  appMetrics.inc(RL_429_COUNTER);
  return sendError(
    res,
    429,
    "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
    "RATE_LIMIT_EXCEEDED"
  );
}

function createSimpleRateLimit({ windowMs, maxRequests }) {
  return async (req, res, next) => {
    const skipInTest =
      process.env.NODE_ENV === "test" && process.env.RATE_LIMIT_IN_TEST !== "1";
    if (skipInTest) {
      return next();
    }

    const key = buildRateLimitKey(req);

    const redisState = await checkRedisLimit({ key, windowMs, maxRequests });
    if (redisState) {
      if (redisState.count > maxRequests) {
        return sendRateLimitResponse(res, redisState.ttlMs);
      }
      return next();
    }

    if (process.env.NODE_ENV === "production") {
      logWarn("[rate-limit] Redis down in production — Strict Fail-closed.", { code: "RATE_LIMIT_REDIS_DOWN_PROD" });
      return sendError(
        res,
        503,
        "Dịch vụ giới hạn yêu cầu đang gián đoạn.",
        "RATE_LIMIT_UNAVAILABLE"
      );
    }

    if (storeMode !== "memory" && !memoryFallbackWarned) {
      logWarn("[rate-limit] Đang dùng store in-memory (fallback).", {
        code: "RATE_LIMIT_USING_MEMORY_FALLBACK",
      });
      memoryFallbackWarned = true;
    }

    const mem = checkMemoryLimit({ key, windowMs, maxRequests });
    if (!mem.allowed) {
      return sendRateLimitResponse(res, mem.ttlMs);
    }
    return next();
  };
}

function getRateLimitStoreMode() {
  initRateLimitRedis();
  return storeMode;
}

/** Test-only: reset singleton state. */
function _resetRateLimitStateForTests() {
  rateLimitRedis = null;
  storeMode = "memory";
  noRedisUrlWarned = false;
  memoryFallbackWarned = false;
  memoryBuckets.clear();
}

module.exports = {
  createSimpleRateLimit,
  getRateLimitStoreMode,
  _resetRateLimitStateForTests,
};
