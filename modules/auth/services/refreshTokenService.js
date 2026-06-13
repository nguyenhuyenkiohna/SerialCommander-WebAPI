/**
 * Refresh Token service — lưu trữ và xác thực refresh tokens qua Redis.
 *
 * Thiết kế:
 *   - Refresh token là một JWT riêng (type="refresh", TTL 7 ngày).
 *   - Hash (SHA-256) của token được lưu trong Redis để cho phép revocation.
 *   - Key Redis: auth:refresh:<userId>:<tokenId>  TTL = REFRESH_TTL_SEC
 *   - Khi logout / đổi mật khẩu: xóa toàn bộ key theo prefix auth:refresh:<userId>:*
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { getSessionClient } = require("../../../kernels/redis/redisClients");
const { getJwtSecret } = require("../../../configs/envSecrets");
const { logWarn } = require("../../../kernels/logging/appLogger");

const REFRESH_TTL_SEC = Number(process.env.JWT_REFRESH_TTL_DAYS || 7) * 24 * 3600;
const REFRESH_PREFIX = "auth:refresh:";

function buildRedisKey(userId, tokenId) {
  return `${REFRESH_PREFIX}${userId}:${tokenId}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function getClient() {
  const client = getSessionClient();
  if (!client) return null;
  if (client.status !== "ready") {
    try { await client.connect(); } catch { return null; }
  }
  return client;
}

/**
 * Tạo refresh token JWT và lưu hash vào Redis.
 * @returns {Promise<string>} raw refresh token (gắn vào cookie)
 */
async function issueRefreshToken(userId) {
  const tokenId = crypto.randomBytes(16).toString("hex");
  const token = jwt.sign(
    { id: userId, tokenId, type: "refresh" },
    getJwtSecret(),
    { expiresIn: `${REFRESH_TTL_SEC}s` }
  );

  const client = await getClient();
  if (client) {
    try {
      await client.set(buildRedisKey(userId, tokenId), hashToken(token), "EX", REFRESH_TTL_SEC);
    } catch (err) {
      logWarn("[refresh-token] Redis SET thất bại — token sẽ không revocable", {
        userId,
        message: err.message,
      });
    }
  }

  return token;
}

/**
 * Xác thực refresh token:
 *   1. Verify JWT signature + expiry
 *   2. Kiểm tra hash trong Redis (revocation check)
 * @returns {{ userId: number|string, tokenId: string } | null}
 */
async function verifyRefreshToken(rawToken) {
  let payload;
  try {
    payload = jwt.verify(rawToken, getJwtSecret());
  } catch {
    return null;
  }

  if (payload.type !== "refresh" || !payload.tokenId || !payload.id) return null;

  const client = await getClient();
  if (client) {
    try {
      const stored = await client.get(buildRedisKey(payload.id, payload.tokenId));
      if (!stored) return null; // đã bị revoke hoặc hết hạn
      if (stored !== hashToken(rawToken)) return null; // hash không khớp
    } catch (err) {
      logWarn("[refresh-token] Redis GET thất bại — cho phép refresh (degraded mode)", {
        message: err.message,
      });
    }
  }

  return { userId: payload.id, tokenId: payload.tokenId };
}

/**
 * Revoke một refresh token cụ thể (sau khi rotate).
 */
async function revokeRefreshToken(userId, tokenId) {
  const client = await getClient();
  if (!client) return;
  try {
    await client.del(buildRedisKey(userId, tokenId));
  } catch { /* best-effort */ }
}

/**
 * Revoke tất cả refresh tokens của user (logout toàn bộ thiết bị).
 * Dùng SCAN để tìm và xóa key theo prefix.
 */
async function revokeAllRefreshTokens(userId) {
  const client = await getClient();
  if (!client) return;
  try {
    const pattern = `${REFRESH_PREFIX}${userId}:*`;
    let cursor = "0";
    do {
      const [nextCursor, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length) await client.del(...keys);
    } while (cursor !== "0");
  } catch (err) {
    logWarn("[refresh-token] revokeAll thất bại", { userId, message: err.message });
  }
}

module.exports = {
  issueRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  REFRESH_TTL_SEC,
};
