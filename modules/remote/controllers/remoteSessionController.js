const { sendError, sendSuccess } = require("../../../kernels/middlewares/errorHandler");
const { User } = require("../../../models");
const remoteSessionService = require("../services/remoteSessionService");
const mosquittoPasswdSync = require("../../../kernels/remoteSession/mosquittoPasswdSync");
const { sendSessionInviteEmail } = require("../../../utils/emailService");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.createSession = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return sendError(res, 401, "Cần đăng nhập để tạo phiên remote", "UNAUTHORIZED");
  }

  try {
    const session = await remoteSessionService.createRemoteSession(userId);
    return sendSuccess(res, 201, "Tạo phiên remote thành công", session);
  } catch (err) {
    const status = Number(err.statusCode) || 500;
    return sendError(res, status, err.message || "Không thể tạo phiên remote", "REMOTE_SESSION_CREATE_FAILED");
  }
};

exports.verifySession = async (req, res) => {
  const requestUserId = req.user?.id;
  if (!requestUserId) {
    return sendError(res, 401, "Cần đăng nhập để tham gia phiên remote", "UNAUTHORIZED");
  }

  const { sessionId, mqttPasswordToken, joinChallenge } = req.body || {};
  const normalizedId = remoteSessionService.normalizeSessionId(sessionId);
  if (!normalizedId) {
    return sendError(res, 400, "sessionId không hợp lệ", "REMOTE_SESSION_INVALID");
  }

  const record = await remoteSessionService.getSessionRecord(normalizedId);
  if (!record) {
    return sendError(res, 404, "Room not found", "REMOTE_ROOM_NOT_FOUND");
  }

  const token = typeof mqttPasswordToken === "string" ? mqttPasswordToken.trim() : "";
  if (token) {
    const valid = await remoteSessionService.verifyRemoteSession(normalizedId, token);
    if (!valid) {
      return sendError(res, 401, "Token phiên remote không hợp lệ", "REMOTE_SESSION_INVALID");
    }
    return sendSuccess(res, 200, "Phiên remote hợp lệ", { valid: true });
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
      "Không có quyền lấy thông tin đăng nhập phiên remote",
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
    return sendError(res, 400, "sessionId hoặc stationId không hợp lệ", "BAD_REQUEST");
  }
  const success = await remoteSessionService.kickStationById(normalizedId, stationId.trim(), requestUserId);
  if (!success) {
    return sendError(res, 403, "Không có quyền hoặc máy trạm không tồn tại trong phiên", "KICK_FAILED");
  }
  return sendSuccess(res, 200, "Đã ngắt kết nối máy trạm", { stationId });
};

exports.sendInviteEmail = async (req, res) => {
  const requestUserId = req.user?.id;
  if (!requestUserId) {
    return sendError(res, 401, "Cần đăng nhập để gửi lời mời", "UNAUTHORIZED");
  }

  const { sessionId, email, inviteUrl } = req.body || {};
  const normalizedId = remoteSessionService.normalizeSessionId(sessionId);
  if (!normalizedId) {
    return sendError(res, 400, "sessionId không hợp lệ", "REMOTE_SESSION_INVALID");
  }
  if (!email || !EMAIL_RE.test(String(email))) {
    return sendError(res, 400, "Email không hợp lệ", "INVALID_EMAIL");
  }
  if (!inviteUrl || typeof inviteUrl !== "string") {
    return sendError(res, 400, "inviteUrl không hợp lệ", "INVALID_INVITE_URL");
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
    return sendError(res, 503, "Gửi email thất bại — kiểm tra cấu hình GMAIL_USER", "EMAIL_SEND_FAILED");
  }
};
