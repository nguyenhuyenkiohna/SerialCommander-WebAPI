const { sendError, sendSuccess } = require("../../../kernels/middlewares/errorHandler");
const { User } = require("../../../models");
const remoteSessionService = require("../services/remoteSessionService");
const mosquittoPasswdSync = require("../../../kernels/remoteSession/mosquittoPasswdSync");
const { sendSessionInviteEmail } = require("../../../utils/emailService");
const { isAllowedInviteUrl } = require("../utils/inviteUrlValidation");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.createSession = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return sendError(res, 401, "Vui lòng đăng nhập để chia sẻ phiên kết nối", "UNAUTHORIZED");
  }

  try {
    const session = await remoteSessionService.createRemoteSession(userId);
    const passwdRequired =
      process.env.NODE_ENV === "production" &&
      Boolean(String(process.env.MQTT_PASSWD_FILE || "").trim());
    if (passwdRequired && session.mqttBrokerPasswdSynced !== true) {
      return sendError(
        res,
        503,
        session.mqttBrokerPasswdHint ||
          "Broker MQTT chưa nhận user phiên — không thể tạo phiên remote an toàn.",
        "MQTT_BROKER_PASSWD_SYNC_FAILED"
      );
    }
    return sendSuccess(res, 201, "Tạo phiên remote thành công", session);
  } catch (err) {
    const status = Number(err.statusCode) || 500;
    return sendError(res, status, err.message || "Không thể tạo phiên kết nối. Vui lòng thử lại.", err.code || "REMOTE_SESSION_CREATE_FAILED");
  }
};

exports.verifySession = async (req, res) => {
  const requestUserId = req.user?.id;
  if (!requestUserId) {
    return sendError(res, 401, "Vui lòng đăng nhập để tham gia phiên kết nối", "UNAUTHORIZED");
  }

  const { sessionId, mqttPasswordToken, joinChallenge } = req.body || {};
  const normalizedId = remoteSessionService.normalizeSessionId(sessionId);
  if (!normalizedId) {
    return sendError(res, 400, "Mã phiên không hợp lệ", "REMOTE_SESSION_INVALID");
  }

  const record = await remoteSessionService.getSessionRecord(normalizedId);
  if (!record) {
    return sendError(res, 404, "Không tìm thấy phiên kết nối", "REMOTE_ROOM_NOT_FOUND");
  }

  const token = typeof mqttPasswordToken === "string" ? mqttPasswordToken.trim() : "";
  if (token) {
    const valid = await remoteSessionService.verifyRemoteSession(normalizedId, token);
    if (!valid) {
      return sendError(res, 401, "Phiên kết nối không hợp lệ hoặc đã hết hạn", "REMOTE_SESSION_INVALID");
    }
    return sendSuccess(res, 200, "Phiên remote hợp lệ", { valid: true });
  }

  /** Host refresh (chỉ sessionId): đồng bộ passwd broker, không tạo stationId. */
  if (remoteSessionService.isSessionHost(record, requestUserId) && !joinChallenge) {
    const credentials = remoteSessionService.buildSessionCredentials(normalizedId, record);
    const passwdSync = await mosquittoPasswdSync.ensureMqttBrokerUser(
      normalizedId,
      record.mqttPasswordToken
    );
    let mqttBrokerPasswdHint;
    if (!passwdSync.synced) {
      mqttBrokerPasswdHint =
        passwdSync.reason === "MQTT_PASSWD_FILE không cấu hình"
          ? "Chưa cấu hình MQTT_PASSWD_FILE — Mosquitto không có user phiên."
          : `Không ghi passwd (${passwdSync.reason || passwdSync.error || "unknown"}).`;
    }
    return sendSuccess(res, 200, "Làm mới credential host thành công", {
      ...credentials,
      mqttBrokerPasswdSynced: passwdSync.synced === true,
      mqttBrokerPasswdReloaded: passwdSync.passwdReloaded === true,
      ...(mqttBrokerPasswdHint ? { mqttBrokerPasswdHint } : {}),
    });
  }

  /** Station join path: kiểm tra blocklist trước khi cấp credentials. */
  const isBlocked = await remoteSessionService.isUserBlocked(normalizedId, requestUserId);
  if (isBlocked) {
    return sendError(
      res, 403,
      "Bạn đã bị host ngắt kết nối khỏi phiên này.",
      "REMOTE_SESSION_KICKED"
    );
  }

  if (
    !remoteSessionService.isAuthorizedForCredentials(record, requestUserId, joinChallenge)
  ) {
    return sendError(
      res,
      403,
      "Bạn không có quyền tham gia phiên này",
      "REMOTE_SESSION_FORBIDDEN"
    );
  }

  const credentials = remoteSessionService.buildSessionCredentials(normalizedId, record);

  /** Tạo stationId server-side và lưu mapping để host có thể kick đúng người. */
  const stationId = await remoteSessionService.registerStation(normalizedId, requestUserId);

  const stationUser = await User.findByPk(requestUserId, {
    attributes: ["username", "email"],
  });
  const displayName =
    stationUser?.username?.trim() ||
    stationUser?.email?.split("@")[0] ||
    `Máy trạm ${stationId.slice(0, 4)}`;

  /** Station: đảm bảo user có trong passwd + HUP (tránh host đã tạo nhưng broker chưa reload). */
  const passwdSync = await mosquittoPasswdSync.ensureMqttBrokerUser(
    normalizedId,
    record.mqttPasswordToken
  );
  let mqttBrokerPasswdHint;
  if (!passwdSync.synced) {
    mqttBrokerPasswdHint =
      passwdSync.reason === "MQTT_PASSWD_FILE không cấu hình"
        ? "Chưa cấu hình MQTT_PASSWD_FILE — Mosquitto không có user phiên."
        : `Không ghi passwd (${passwdSync.reason || passwdSync.error || "unknown"}).`;
  }

  return sendSuccess(res, 200, "Lấy thông tin phiên remote thành công", {
    ...credentials,
    stationId,
    displayName,
    mqttBrokerPasswdSynced: passwdSync.synced === true,
    mqttBrokerPasswdReloaded: passwdSync.passwdReloaded === true,
    ...(mqttBrokerPasswdHint ? { mqttBrokerPasswdHint } : {}),
  });
};

exports.kickSessionStation = async (req, res) => {
  const requestUserId = req.user?.id;
  if (!requestUserId) {
    return sendError(res, 401, "Cần đăng nhập", "UNAUTHORIZED");
  }
  const { sessionId, stationId } = req.body || {};
  const normalizedId = remoteSessionService.normalizeSessionId(sessionId);
  if (!normalizedId || !stationId || typeof stationId !== "string") {
    return sendError(res, 400, "Thông tin phiên không hợp lệ", "BAD_REQUEST");
  }
  const success = await remoteSessionService.kickStationById(normalizedId, stationId.trim(), requestUserId);
  if (!success) {
    return sendError(res, 403, "Không có quyền hoặc máy trạm không tồn tại trong phiên", "KICK_FAILED");
  }
  return sendSuccess(res, 200, "Đã ngắt kết nối máy trạm", { stationId });
};

/**
 * Host kết thúc phiên ngay lập tức: xóa session store + thu hồi credential broker.
 * @alias /session/end
 */
exports.endSession = async (req, res) => {
  const requestUserId = req.user?.id;
  if (!requestUserId) {
    return sendError(res, 401, "Cần đăng nhập", "UNAUTHORIZED");
  }
  const { sessionId } = req.body || {};
  const normalizedId = remoteSessionService.normalizeSessionId(sessionId);
  if (!normalizedId) {
    return sendError(res, 400, "Mã phiên không hợp lệ", "REMOTE_SESSION_INVALID");
  }

  const result = await remoteSessionService.endRemoteSession(normalizedId, requestUserId);
  if (!result.ended) {
    if (result.reason === "not_found") {
      return sendError(res, 404, "Phiên remote không tồn tại hoặc đã kết thúc", "REMOTE_ROOM_NOT_FOUND");
    }
    return sendError(res, 403, "Chỉ host mới được kết thúc phiên", "REMOTE_SESSION_FORBIDDEN");
  }
  return sendSuccess(res, 200, "Đã kết thúc phiên remote và thu hồi credential", {
    sessionId: normalizedId,
    mqttBrokerUserRemoved: result.mqttBrokerUserRemoved === true,
  });
};

exports.sendInviteEmail = async (req, res) => {
  const requestUserId = req.user?.id;
  if (!requestUserId) {
    return sendError(res, 401, "Cần đăng nhập để gửi lời mời", "UNAUTHORIZED");
  }

  const { sessionId, email, inviteUrl } = req.body || {};
  const normalizedId = remoteSessionService.normalizeSessionId(sessionId);
  if (!normalizedId) {
    return sendError(res, 400, "Mã phiên không hợp lệ", "REMOTE_SESSION_INVALID");
  }
  if (!email || !EMAIL_RE.test(String(email))) {
    return sendError(res, 400, "Email không hợp lệ", "INVALID_EMAIL");
  }
  if (!inviteUrl || typeof inviteUrl !== "string" || !isAllowedInviteUrl(inviteUrl)) {
    return sendError(res, 400, "Liên kết mời không hợp lệ hoặc không thuộc domain cho phép", "INVALID_INVITE_URL");
  }

  const record = await remoteSessionService.getSessionRecord(normalizedId);
  if (!record) {
    return sendError(res, 404, "Phiên remote không tồn tại", "REMOTE_ROOM_NOT_FOUND");
  }
  if (!remoteSessionService.isSessionHost(record, requestUserId)) {
    return sendError(res, 403, "Chỉ host mới được gửi lời mời", "REMOTE_SESSION_FORBIDDEN");
  }

  try {
    await sendSessionInviteEmail(String(email).toLowerCase().trim(), inviteUrl, req.user?.name);
    return sendSuccess(res, 200, "Đã gửi lời mời qua email", { email });
  } catch (err) {
    return sendError(res, 503, "Không gửi được email mời. Vui lòng thử lại sau.", "EMAIL_SEND_FAILED");
  }
};
