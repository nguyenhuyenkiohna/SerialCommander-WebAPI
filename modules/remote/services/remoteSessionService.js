const crypto = require("crypto");
const remoteSessionStore = require("../../../kernels/remoteSession/remoteSessionStore");
const mosquittoPasswdSync = require("../../../kernels/remoteSession/mosquittoPasswdSync");

const SESSION_ID_BYTES = 8;
const PASSWORD_TOKEN_BYTES = 32;
const JOIN_CHALLENGE_BYTES = 16;
const SESSION_ID_PATTERN = /^[a-f0-9]{16}$/;
const JOIN_CHALLENGE_PATTERN = /^[a-f0-9]{32}$/;

function generateSessionId() {
  return crypto.randomBytes(SESSION_ID_BYTES).toString("hex");
}

function generateMqttPasswordToken() {
  return crypto.randomBytes(PASSWORD_TOKEN_BYTES).toString("base64");
}

function generateJoinChallenge() {
  return crypto.randomBytes(JOIN_CHALLENGE_BYTES).toString("hex");
}

function normalizeJoinChallenge(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return JOIN_CHALLENGE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeSessionId(sessionId) {
  if (typeof sessionId !== "string") return null;
  const normalized = sessionId.trim().toLowerCase();
  return SESSION_ID_PATTERN.test(normalized) ? normalized : null;
}

async function createRemoteSession(userId) {
  if (!userId) {
    const err = new Error("Thiếu userId");
    err.statusCode = 400;
    throw err;
  }

  let sessionId = "";
  let mqttPasswordToken = "";
  const joinChallenge = generateJoinChallenge();
  const ttlSeconds = remoteSessionStore.ttlSeconds();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    sessionId = generateSessionId();
    mqttPasswordToken = generateMqttPasswordToken();
    const existing = await remoteSessionStore.getSession(sessionId);
    if (!existing) break;
    if (attempt === 4) {
      const err = new Error("Không thể tạo sessionId duy nhất");
      err.statusCode = 503;
      throw err;
    }
  }

  await remoteSessionStore.saveSession(sessionId, {
    userId,
    mqttPasswordToken,
    joinChallenge,
    createdAt: new Date().toISOString(),
    expiresAt,
  });

  const passwdSync = await mosquittoPasswdSync.upsertMqttBrokerUser(sessionId, mqttPasswordToken);

  /** Gợi ý frontend khi broker chưa nhận user → CONNACK Not authorized. */
  let mqttBrokerPasswdHint;
  if (!passwdSync.synced) {
    if (passwdSync.reason === "MQTT_PASSWD_FILE không cấu hình") {
      mqttBrokerPasswdHint =
        "Chưa cấu hình MQTT_PASSWD_FILE trong .env — Mosquitto không có user phiên trong passwd (CONNACK Not authorized).";
    } else {
      mqttBrokerPasswdHint =
        `Không ghi user MQTT vào file passwd (${passwdSync.reason || passwdSync.error || "unknown"}). Cần mosquitto_passwd hoặc Docker; kiểm tra đường dẫn file và Docker đang chạy.`;
    }
  }

  return {
    sessionId,
    mqttPasswordToken,
    joinChallenge,
    expiresAt,
    ttlSeconds,
    topicPrefix: `serial/chat/${sessionId}`,
    mqttBrokerPasswdSynced: passwdSync.synced === true,
    ...(mqttBrokerPasswdHint ? { mqttBrokerPasswdHint } : {}),
  };
}

async function verifyRemoteSession(sessionId, mqttPasswordToken) {
  const normalizedId = normalizeSessionId(sessionId);
  if (!normalizedId || typeof mqttPasswordToken !== "string" || !mqttPasswordToken.trim()) {
    return false;
  }
  return remoteSessionStore.verifySessionCredentials(normalizedId, mqttPasswordToken.trim());
}

async function getSessionRecord(sessionId) {
  const normalizedId = normalizeSessionId(sessionId);
  if (!normalizedId) return null;
  const record = await remoteSessionStore.getSession(normalizedId);
  if (!record?.mqttPasswordToken) return null;
  return { sessionId: normalizedId, ...record };
}

function isSessionHost(record, requestUserId) {
  if (!record || requestUserId == null) return false;
  return String(record.userId) === String(requestUserId);
}

function isAuthorizedForCredentials(record, requestUserId, joinChallenge) {
  if (!record) return false;
  if (isSessionHost(record, requestUserId)) return true;
  const normalizedChallenge = normalizeJoinChallenge(joinChallenge);
  if (!normalizedChallenge) return false;
  return remoteSessionStore.verifyJoinChallenge(record, normalizedChallenge);
}

function buildSessionCredentials(sessionId, record) {
  const ttlSeconds = remoteSessionStore.ttlSeconds();
  return {
    sessionId,
    mqttPasswordToken: record.mqttPasswordToken,
    // Dùng expiresAt đã lưu khi tạo session thay vì tính lại (now+TTL sẽ sai với session cũ).
    expiresAt: record.expiresAt || new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    ttlSeconds,
    topicPrefix: `serial/chat/${sessionId}`,
  };
}

/** Tạo stationId server-side và lưu mapping stationId → userId vào session. */
async function registerStation(sessionId, userId) {
  const stationId = crypto.randomBytes(4).toString("hex");
  await remoteSessionStore.addStationMapping(sessionId, stationId, userId);
  return stationId;
}

/**
 * Host kick một station theo stationId.
 * Tra mapping → lấy userId → block userId trong session.
 * Trả về false nếu không tìm thấy station hoặc requester không phải host.
 */
async function kickStationById(sessionId, stationId, requestUserId) {
  const record = await remoteSessionStore.getSession(sessionId);
  if (!record) return false;
  if (!isSessionHost(record, requestUserId)) return false;
  const stationMap = record.stationMap || {};
  const stationUserId = stationMap[stationId];
  if (!stationUserId) return false;
  await remoteSessionStore.blockUser(sessionId, stationUserId);
  return true;
}

module.exports = {
  SESSION_ID_PATTERN,
  JOIN_CHALLENGE_PATTERN,
  normalizeSessionId,
  normalizeJoinChallenge,
  createRemoteSession,
  verifyRemoteSession,
  getSessionRecord,
  isSessionHost,
  isAuthorizedForCredentials,
  buildSessionCredentials,
  registerStation,
  kickStationById,
  isUserBlocked: remoteSessionStore.isUserBlocked,
};
