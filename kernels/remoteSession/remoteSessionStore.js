const crypto = require("crypto");
const { logWarn } = require("../logging/appLogger");
const { getSessionClient } = require("../redis/redisClients");

/**
 * Lua script: atomic add stationId→userId vào stationMap.
 * Tránh race condition GET+SET khi nhiều station join đồng thời.
 * Returns: 0 nếu session không tồn tại, 1 nếu thành công.
 */
const LUA_ADD_STATION_MAPPING = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local data = cjson.decode(raw)
if not data.stationMap then data.stationMap = {} end
data.stationMap[ARGV[1]] = ARGV[2]
local ttl = redis.call('TTL', KEYS[1])
if ttl <= 0 then ttl = tonumber(ARGV[3]) end
redis.call('SET', KEYS[1], cjson.encode(data), 'EX', ttl)
return 1
`;

/**
 * Lua script: Compare-And-Swap cho updateSession.
 * So sánh raw JSON hiện tại với expected — nếu khớp thì SET new value.
 * Prevents GET-SET race condition khi nhiều request đồng thời cập nhật session.
 *
 * Returns:
 *   1  = swap thành công
 *   0  = key không tồn tại
 *  -1  = giá trị đã bị thay đổi (retry)
 */
const LUA_COMPARE_AND_SWAP = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
if current ~= ARGV[1] then return -1 end
local ttl = redis.call('TTL', KEYS[1])
if ttl <= 0 then ttl = tonumber(ARGV[3]) end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ttl)
return 1
`;

/**
 * Lua script: atomic thêm userId vào blockedUsers array.
 * Idempotent — không thêm trùng.
 * Returns: 0 không tìm thấy session, 1 blocked, 2 đã blocked rồi.
 */
const LUA_BLOCK_USER = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local data = cjson.decode(raw)
if not data.blockedUsers then data.blockedUsers = {} end
local uid = ARGV[1]
for _, v in ipairs(data.blockedUsers) do
  if v == uid then return 2 end
end
table.insert(data.blockedUsers, uid)
local ttl = redis.call('TTL', KEYS[1])
if ttl <= 0 then ttl = tonumber(ARGV[2]) end
redis.call('SET', KEYS[1], cjson.encode(data), 'EX', ttl)
return 1
`;

const DEFAULT_TTL_SECONDS = 2 * 60 * 60;
const MEMORY_STORE = new Map();

function isProductionEnv() {
  return process.env.NODE_ENV === "production";
}

function throwIfProductionMemoryFallback(operation, err) {
  if (!isProductionEnv()) return;
  const detail = err?.message || String(err || "unknown");
  const message = `[remote-session] CRITICAL: ${operation} — in-memory fallback disabled in production: ${detail}`;
  console.error(message);
  throw new Error(message);
}

function ttlSeconds() {
  const raw = parseInt(process.env.REMOTE_SESSION_TTL_SECONDS || String(DEFAULT_TTL_SECONDS), 10);
  return Number.isFinite(raw) && raw > 60 ? raw : DEFAULT_TTL_SECONDS;
}

function getRedisClient() {
  return getSessionClient();
}

function memoryKey(sessionId) {
  return `remote:session:${sessionId}`;
}

function pruneMemoryStore() {
  const now = Date.now();
  for (const [key, entry] of MEMORY_STORE.entries()) {
    if (entry.expiresAtMs <= now) MEMORY_STORE.delete(key);
  }
}

async function saveSession(sessionId, payload) {
  const ttl = ttlSeconds();
  const body = JSON.stringify(payload);
  const client = getRedisClient();
  if (client) {
    try {
      if (client.status !== "ready") await client.connect();
      await client.set(`remote:session:${sessionId}`, body, "EX", ttl);
      return { ttlSeconds: ttl };
    } catch (err) {
      logWarn("[remote-session] Redis SET failed, trying fallback", { message: err.message });
    }
  }

  try {
    const { sequelize } = require("../../models");
    const expiresAt = new Date(Date.now() + ttl * 1000);
    await sequelize.query(
      `INSERT INTO remote_sessions (session_id, user_id, mqtt_password_token, join_challenge, expires_at)
       VALUES (:sessionId, :userId, :mqttPasswordToken, :joinChallenge, :expiresAt)
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id),
         mqtt_password_token = VALUES(mqtt_password_token),
         join_challenge = VALUES(join_challenge),
         expires_at = VALUES(expires_at)`,
      {
        replacements: {
          sessionId,
          userId: payload.userId,
          mqttPasswordToken: payload.mqttPasswordToken,
          joinChallenge: payload.joinChallenge || null,
          expiresAt,
        },
      }
    );
    return { ttlSeconds: ttl };
  } catch (err) {
    logWarn("[remote-session] MySQL fallback failed, using in-memory", {
      message: err.message || String(err),
    });
    throwIfProductionMemoryFallback("saveSession after Redis/MySQL failure", err);
  }

  pruneMemoryStore();
  MEMORY_STORE.set(memoryKey(sessionId), {
    payload,
    expiresAtMs: Date.now() + ttl * 1000,
  });
  return { ttlSeconds: ttl };
}

async function getSession(sessionId) {
  const client = getRedisClient();
  if (client) {
    try {
      if (client.status !== "ready") await client.connect();
      const raw = await client.get(`remote:session:${sessionId}`);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      logWarn("[remote-session] Redis GET failed", { message: err.message });
    }
  }

  try {
    const { sequelize } = require("../../models");
    const { QueryTypes } = require("sequelize");
    const rows = await sequelize.query(
      `SELECT user_id AS userId, mqtt_password_token AS mqttPasswordToken,
              join_challenge AS joinChallenge
       FROM remote_sessions
       WHERE session_id = :sessionId AND expires_at > UTC_TIMESTAMP()
       LIMIT 1`,
      { replacements: { sessionId }, type: QueryTypes.SELECT }
    );
    if (rows && rows[0]) return rows[0];
  } catch {
    /* table may not exist in dev */
  }

  if (!isProductionEnv()) {
    pruneMemoryStore();
    const entry = MEMORY_STORE.get(memoryKey(sessionId));
    if (!entry || entry.expiresAtMs <= Date.now()) return null;
    return entry.payload;
  }
  return null;
}

function timingSafeEqualString(a, b) {
  // Hash cả hai trước khi so sánh: loại bỏ timing leak từ early-return theo độ dài.
  const hashA = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const hashB = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

async function verifySessionCredentials(sessionId, mqttPasswordToken) {
  const record = await getSession(sessionId);
  if (!record || !record.mqttPasswordToken) return false;
  return timingSafeEqualString(record.mqttPasswordToken, mqttPasswordToken);
}

function verifyJoinChallenge(record, joinChallenge) {
  if (!record?.joinChallenge || !joinChallenge) return false;
  return timingSafeEqualString(record.joinChallenge, joinChallenge);
}

async function getActiveSessionIds() {
  const client = getRedisClient();
  if (client) {
    try {
      if (client.status !== "ready") await client.connect();
      const sessionIds = [];
      let cursor = "0";
      do {
        const [nextCursor, keys] = await client.scan(
          cursor, "MATCH", "remote:session:*", "COUNT", 200
        );
        cursor = nextCursor;
        for (const key of keys) {
          sessionIds.push(key.replace("remote:session:", ""));
        }
      } while (cursor !== "0");
      return sessionIds;
    } catch (err) {
      logWarn("[remote-session] Redis SCAN failed", { message: err.message });
    }
  }

  try {
    const { sequelize } = require("../../models");
    const { QueryTypes } = require("sequelize");
    const rows = await sequelize.query(
      `SELECT session_id AS sessionId
       FROM remote_sessions
       WHERE expires_at > UTC_TIMESTAMP()`,
      { type: QueryTypes.SELECT }
    );
    if (rows && rows.length > 0) return rows.map(r => r.sessionId);
  } catch {
    /* table may not exist in dev */
  }

  if (!isProductionEnv()) {
    pruneMemoryStore();
    const sessionIds = [];
    for (const [key, entry] of MEMORY_STORE.entries()) {
      if (entry.expiresAtMs > Date.now()) {
        sessionIds.push(key.replace("remote:session:", ""));
      }
    }
    return sessionIds;
  }
  return [];
}

/**
 * Cập nhật một phần dữ liệu session (Redis CAS + in-memory fallback).
 * MySQL không hỗ trợ — stationMap/blockedUsers là dữ liệu ephemeral.
 *
 * Redis path dùng Compare-And-Swap Lua để tránh race condition GET-SET:
 *   1. GET current raw value
 *   2. JS: run updater(currentData) → newData
 *   3. Lua: atomic check current == expected → SET newData
 *   Nếu có writer khác chen vào giữa bước 1 và 3, Lua trả -1 và ta retry.
 */
const CAS_MAX_RETRIES = 3;

async function updateSession(sessionId, updater) {
  const client = getRedisClient();
  if (client) {
    const key = `remote:session:${sessionId}`;
    for (let attempt = 0; attempt < CAS_MAX_RETRIES; attempt++) {
      try {
        if (client.status !== "ready") await client.connect();
        const raw = await client.get(key);
        if (!raw) return false;
        const data = JSON.parse(raw);
        const updated = updater(data);
        const ttl = await client.ttl(key);
        const effectiveTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_SECONDS;
        const newRaw = JSON.stringify(updated);
        const result = await client.eval(
          LUA_COMPARE_AND_SWAP, 1, key, raw, newRaw, String(effectiveTtl)
        );
        if (result === 1) return true;
        if (result === 0) return false; // key đã bị xóa
        // result === -1: concurrent writer đã đổi value, retry
      } catch (err) {
        logWarn("[remote-session] Redis CAS updateSession failed", {
          message: err.message,
          attempt,
        });
        break;
      }
    }
    logWarn("[remote-session] updateSession: all CAS retries exhausted", { sessionId });
    return false;
  }
  if (isProductionEnv()) {
    return false;
  }
  // In-memory fallback chỉ dùng trong dev (single-threaded → không có race condition).
  pruneMemoryStore();
  const key = memoryKey(sessionId);
  const entry = MEMORY_STORE.get(key);
  if (!entry || entry.expiresAtMs <= Date.now()) return false;
  entry.payload = updater(entry.payload);
  return true;
}

/** Lưu mapping stationId → userId để host có thể kick đúng người. */
async function addStationMapping(sessionId, stationId, userId) {
  const client = getRedisClient();
  if (client) {
    try {
      if (client.status !== "ready") await client.connect();
      const ttl = ttlSeconds();
      const result = await client.eval(
        LUA_ADD_STATION_MAPPING,
        1,
        `remote:session:${sessionId}`,
        String(stationId),
        String(userId),
        String(ttl)
      );
      if (result !== 0) return true;
      // result=0 → session không tồn tại trong Redis, thử fallback
    } catch (err) {
      logWarn("[remote-session] Redis eval LUA_ADD_STATION_MAPPING failed", { message: err.message });
    }
  }
  // Fallback: in-memory path (single-threaded, không có race condition)
  return updateSession(sessionId, (data) => ({
    ...data,
    stationMap: { ...(data.stationMap || {}), [stationId]: String(userId) },
  }));
}

/** Block một userId — `verifySession` sẽ trả 403 cho người này. */
async function blockUser(sessionId, userId) {
  const client = getRedisClient();
  if (client) {
    try {
      if (client.status !== "ready") await client.connect();
      const ttl = ttlSeconds();
      const result = await client.eval(
        LUA_BLOCK_USER,
        1,
        `remote:session:${sessionId}`,
        String(userId),
        String(ttl)
      );
      if (result !== 0) return true; // 1=blocked, 2=already blocked
      // result=0 → session không tồn tại, thử fallback
    } catch (err) {
      logWarn("[remote-session] Redis eval LUA_BLOCK_USER failed", { message: err.message });
    }
  }
  // Fallback: in-memory path
  return updateSession(sessionId, (data) => {
    const blocked = Array.isArray(data.blockedUsers) ? data.blockedUsers : [];
    const uid = String(userId);
    if (blocked.includes(uid)) return data;
    return { ...data, blockedUsers: [...blocked, uid] };
  });
}

/**
 * Xóa session ngay lập tức (host kết thúc phiên) — Redis + MySQL fallback + memory.
 * Idempotent: trả về true nếu có ít nhất một store thực sự xóa bản ghi.
 */
async function deleteSession(sessionId) {
  let deleted = false;
  const client = getRedisClient();
  if (client) {
    try {
      if (client.status !== "ready") await client.connect();
      const n = await client.del(`remote:session:${sessionId}`);
      if (n > 0) deleted = true;
    } catch (err) {
      logWarn("[remote-session] Redis DEL failed", { message: err.message });
    }
  }

  try {
    const { sequelize } = require("../../models");
    await sequelize.query(
      `DELETE FROM remote_sessions WHERE session_id = :sessionId`,
      { replacements: { sessionId } }
    );
  } catch {
    /* table may not exist in dev */
  }

  if (MEMORY_STORE.delete(memoryKey(sessionId))) deleted = true;
  return deleted;
}

async function isUserBlocked(sessionId, userId) {
  const record = await getSession(sessionId);
  if (!record || !Array.isArray(record.blockedUsers)) return false;
  return record.blockedUsers.includes(String(userId));
}

module.exports = {
  ttlSeconds,
  saveSession,
  getSession,
  deleteSession,
  updateSession,
  addStationMapping,
  blockUser,
  isUserBlocked,
  verifySessionCredentials,
  verifyJoinChallenge,
  getActiveSessionIds,
};
