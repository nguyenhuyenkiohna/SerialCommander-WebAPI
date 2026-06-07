const crypto = require("crypto");
const { logWarn } = require("../logging/appLogger");
const { getSessionClient } = require("../redis/redisClients");

const DEFAULT_TTL_SECONDS = 2 * 60 * 60;
const MEMORY_STORE = new Map();

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

  pruneMemoryStore();
  const entry = MEMORY_STORE.get(memoryKey(sessionId));
  if (!entry || entry.expiresAtMs <= Date.now()) return null;
  return entry.payload;
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

  pruneMemoryStore();
  const sessionIds = [];
  for (const [key, entry] of MEMORY_STORE.entries()) {
    if (entry.expiresAtMs > Date.now()) {
      sessionIds.push(key.replace("remote:session:", ""));
    }
  }
  return sessionIds;
}

/**
 * Cập nhật một phần dữ liệu session (Redis + in-memory fallback).
 * MySQL không hỗ trợ — stationMap/blockedUsers là dữ liệu ephemeral.
 */
async function updateSession(sessionId, updater) {
  const client = getRedisClient();
  if (client) {
    try {
      if (client.status !== "ready") await client.connect();
      const raw = await client.get(`remote:session:${sessionId}`);
      if (!raw) return false;
      const data = JSON.parse(raw);
      const updated = updater(data);
      const ttl = await client.ttl(`remote:session:${sessionId}`);
      const effectiveTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_SECONDS;
      await client.set(`remote:session:${sessionId}`, JSON.stringify(updated), "EX", effectiveTtl);
      return true;
    } catch (err) {
      logWarn("[remote-session] Redis UPDATE failed", { message: err.message });
    }
  }
  pruneMemoryStore();
  const key = memoryKey(sessionId);
  const entry = MEMORY_STORE.get(key);
  if (!entry || entry.expiresAtMs <= Date.now()) return false;
  entry.payload = updater(entry.payload);
  return true;
}

/** Lưu mapping stationId → userId để host có thể kick đúng người. */
async function addStationMapping(sessionId, stationId, userId) {
  return updateSession(sessionId, (data) => ({
    ...data,
    stationMap: { ...(data.stationMap || {}), [stationId]: String(userId) },
  }));
}

/** Block một userId — `verifySession` sẽ trả 403 cho người này. */
async function blockUser(sessionId, userId) {
  return updateSession(sessionId, (data) => {
    const blocked = Array.isArray(data.blockedUsers) ? data.blockedUsers : [];
    const uid = String(userId);
    if (blocked.includes(uid)) return data;
    return { ...data, blockedUsers: [...blocked, uid] };
  });
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
  updateSession,
  addStationMapping,
  blockUser,
  isUserBlocked,
  verifySessionCredentials,
  verifyJoinChallenge,
  getActiveSessionIds,
};
