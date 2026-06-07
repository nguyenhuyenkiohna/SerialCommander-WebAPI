/**
 * Đồng bộ sessionId + mqttPasswordToken vào Mosquitto password_file.
 * Khớp MqttContext: username=sessionId, password=mqttPasswordToken (plain, broker hash bằng mosquitto_passwd).
 *
 * Lưu ý: MQTT_PASSWD_FILE nên là đường dẫn tương đối WebAPI root — resolve theo __dirname, không theo process.cwd().
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { logInfo, logWarn } = require("../logging/appLogger");

const execFileAsync = promisify(execFile);
const SESSION_ID_PATTERN = /^[a-f0-9]{16}$/;

/**
 * Hàng đợi tuần tự cho các thao tác ghi passwd file.
 * Tránh race condition khi nhiều session được tạo cùng lúc.
 */
let _writeQueue = Promise.resolve();
function enqueueWrite(fn) {
  // Luôn gọi fn() không có argument (không truyền rejection error làm arg).
  // Đảm bảo queue tiếp tục chạy dù promise trước thành công hay thất bại.
  _writeQueue = _writeQueue.then(() => fn(), () => fn());
  return _writeQueue;
}

/** Delay dùng để đợi Mosquitto hoàn tất reload sau HUP. */
const MOSQUITTO_RELOAD_DELAY_MS = Number(process.env.MQTT_BROKER_RELOAD_DELAY_MS || 1200);

/** SerialCommander-WebAPI-main/ (từ kernels/remoteSession/). */
const WEBAPI_ROOT = path.join(__dirname, "..", "..");

function passwdFilePath() {
  const raw = process.env.MQTT_PASSWD_FILE;
  if (!raw || !String(raw).trim()) return null;
  const trimmed = String(raw).trim();
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.resolve(WEBAPI_ROOT, trimmed);
}

/** Dev: Compose demo/full stack — HUP để broker đọc lại passwd (không HUP → CONNACK Not authorized). */
const DEFAULT_DEV_HUP_CONTAINERS = ["sc-mqtt-demo", "sc-mqtt"];

async function reloadMqttBrokerInDocker() {
  const explicit = (
    process.env.MQTT_BROKER_HUP_CONTAINER ||
    process.env.MQTT_BROKER_RELOAD_CONTAINER ||
    ""
  ).trim();

  const candidates = explicit
    ? [explicit]
    : process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test"
      ? []
      : DEFAULT_DEV_HUP_CONTAINERS;

  if (!candidates.length) return;

  for (const name of candidates) {
    try {
      await execFileAsync("docker", ["kill", "-s", "HUP", name], {
        timeout: 8000,
      });
      logInfo("[mosquitto-passwd] đã HUP Mosquitto (reload password_file)", { container: name });
      return;
    } catch {
      /* thử container dev tiếp theo */
    }
  }

  for (const name of candidates) {
    try {
      await execFileAsync("docker", ["restart", name], { timeout: 25000 });
      logInfo("[mosquitto-passwd] đã restart Mosquitto (reload passwd)", { container: name });
      await new Promise((r) => setTimeout(r, 1500));
      return;
    } catch {
      /* thử container tiếp */
    }
  }

  logWarn(
    "[mosquitto-passwd] không HUP/restart được container — broker có thể chưa đọc user mới (Not authorized).",
    { tried: candidates }
  );
}

/**
 * mosquitto_passwd qua eclipse-mosquitto image khi không có CLI trên host.
 */
async function upsertViaDockerPasswd(absFilePath, sessionId, mqttPasswordToken, createNew) {
  const dir = path.dirname(absFilePath);
  const volPath = fs.existsSync(dir) ? dir : path.dirname(absFilePath);
  const basename = path.basename(absFilePath);
  const mounted = "/cfg";
  const args = ["run", "--rm", "-v", `${volPath}:${mounted}`, "eclipse-mosquitto:2", "mosquitto_passwd"];
  if (createNew) args.push("-b", "-c", `${mounted}/${basename}`, sessionId, mqttPasswordToken);
  else args.push("-b", `${mounted}/${basename}`, sessionId, mqttPasswordToken);

  await execFileAsync("docker", args, { timeout: 20000 });
}

async function upsertViaNativePasswd(absFilePath, sessionId, mqttPasswordToken, createNew) {
  const args = createNew
    ? ["-b", "-c", absFilePath, sessionId, mqttPasswordToken]
    : ["-b", absFilePath, sessionId, mqttPasswordToken];
  await execFileAsync("mosquitto_passwd", args, { timeout: 8000 });
}

/**
 * Thực hiện ghi user vào passwd file (không có serialization — gọi qua enqueueWrite).
 * @returns {Promise<{ synced?: boolean, skipped?: boolean, reason?: string, error?: string }>}
 */
async function _doUpsertMqttBrokerUser(sessionId, mqttPasswordToken) {
  const file = passwdFilePath();
  if (!file) return { skipped: true, reason: "MQTT_PASSWD_FILE không cấu hình" };

  const dir = path.dirname(file);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    logWarn("[mosquitto-passwd] không mkdir được", { dir, message: err.message });
    return { skipped: true, reason: "mkdir_failed", error: err.message };
  }

  const createNew = !fs.existsSync(file);

  const tryDockerOnFailure = async (cause) => {
    try {
      await upsertViaDockerPasswd(file, sessionId, mqttPasswordToken, createNew);
      logInfo("[mosquitto-passwd] đã ghi user phiên (docker mosquitto_passwd)", { sessionId });
      return { synced: true, viaDocker: true, needsReload: true };
    } catch (dockerErr) {
      logWarn("[mosquitto-passwd] docker mosquitto_passwd thất bại", {
        sessionId, cause, message: dockerErr.message, file,
      });
      return { skipped: true, reason: cause, error: dockerErr.message };
    }
  };

  try {
    await upsertViaNativePasswd(file, sessionId, mqttPasswordToken, createNew);
    logInfo("[mosquitto-passwd] đã ghi user phiên", { sessionId });
    return { synced: true, needsReload: true };
  } catch (nativeErr) {
    const msg = nativeErr.message || String(nativeErr);
    logWarn("[mosquitto-passwd] mosquitto_passwd CLI thất bại — thử Docker", { sessionId, message: msg });
    return tryDockerOnFailure("native_failed");
  }
}

/**
 * Ghi user vào Mosquitto passwd file theo hàng đợi tuần tự để tránh race condition.
 * Sau khi ghi xong, gửi HUP và đợi Mosquitto reload trước khi return.
 *
 * @param {string} sessionId 16 hex — username broker
 * @param {string} mqttPasswordToken mật khẩu broker (plain — giống lúc CONNECT)
 * @returns {Promise<{ synced?: boolean, skipped?: boolean, reason?: string, error?: string }>}
 */
function passwdFileHasUser(sessionId) {
  const file = passwdFilePath();
  if (!file || !fs.existsSync(file)) return false;
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    return lines.some((line) => line.startsWith(`${sessionId}:`));
  } catch {
    return false;
  }
}

/**
 * Station verify: chỉ ghi passwd + HUP khi user chưa có — tránh cắt CONNACK host/station đang kết nối.
 */
async function ensureMqttBrokerUser(sessionId, mqttPasswordToken) {
  if (passwdFileHasUser(sessionId)) {
    logInfo("[mosquitto-passwd] user đã có trong passwd — bỏ qua ghi/HUP", { sessionId });
    return { synced: true, alreadyPresent: true, passwdReloaded: false };
  }
  const result = await upsertMqttBrokerUser(sessionId, mqttPasswordToken);
  return { ...result, passwdReloaded: result.needsReload === true };
}

async function upsertMqttBrokerUser(sessionId, mqttPasswordToken) {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    logWarn("[mosquitto-passwd] sessionId không hợp lệ", { sessionId });
    return { skipped: true, reason: "invalid_session_id" };
  }
  if (!mqttPasswordToken || typeof mqttPasswordToken !== "string") {
    return { skipped: true, reason: "missing_password" };
  }

  // Serialise writes: tránh hai tiến trình mosquitto_passwd ghi đồng thời làm hỏng file.
  const result = await enqueueWrite(() => _doUpsertMqttBrokerUser(sessionId, mqttPasswordToken));

  if (result.needsReload) {
    // Gửi HUP và đợi Mosquitto reload xong trước khi trả về cho frontend.
    await reloadMqttBrokerInDocker();
    await new Promise((r) => setTimeout(r, MOSQUITTO_RELOAD_DELAY_MS));
  }

  return result;
}

/**
 * Remove an expired user from the Mosquitto password file.
 */
async function removeViaDockerPasswd(absFilePath, sessionId) {
  const dir = path.dirname(absFilePath);
  const volPath = fs.existsSync(dir) ? dir : path.dirname(absFilePath);
  const basename = path.basename(absFilePath);
  const mounted = "/cfg";
  const args = ["run", "--rm", "-v", `${volPath}:${mounted}`, "eclipse-mosquitto:2", "mosquitto_passwd", "-D", `${mounted}/${basename}`, sessionId];
  await execFileAsync("docker", args, { timeout: 20000 });
}

async function removeViaNativePasswd(absFilePath, sessionId) {
  const args = ["-D", absFilePath, sessionId];
  await execFileAsync("mosquitto_passwd", args, { timeout: 8000 });
}

/**
 * Parses the mosquitto passwd file and removes usernames (sessionIds) that no longer exist in Redis.
 * Runs periodically to clean up the file and prevent hackers from reusing old sessions.
 */
async function cleanupExpiredUsers(getActiveSessionIdsFn) {
  const file = passwdFilePath();
  if (!file || !fs.existsSync(file)) return { skipped: true, reason: "MQTT_PASSWD_FILE không tồn tại hoặc không được cấu hình" };

  try {
    const fileContent = fs.readFileSync(file, 'utf8');
    const lines = fileContent.split('\n');
    const userIdsInFile = lines
      .map(line => line.split(':')[0])
      .filter(user => SESSION_ID_PATTERN.test(user)); // only consider actual session IDs

    if (userIdsInFile.length === 0) return { skipped: true, reason: "Không có session ID nào trong file" };

    const activeSessionIds = await getActiveSessionIdsFn();
    const activeSet = new Set(activeSessionIds);
    let removedCount = 0;

    for (const sessionId of userIdsInFile) {
      if (!activeSet.has(sessionId)) {
        // Serialize qua enqueueWrite để không xung đột với upsertMqttBrokerUser đang chạy.
        const removed = await enqueueWrite(async () => {
          try {
            await removeViaNativePasswd(file, sessionId);
            return true;
          } catch {
            try {
              await removeViaDockerPasswd(file, sessionId);
              return true;
            } catch (dockerErr) {
              logWarn("[mosquitto-passwd] Xóa user thất bại (cả native và docker)", { sessionId, message: dockerErr.message });
              return false;
            }
          }
        });
        if (removed) removedCount++;
      }
    }

    if (removedCount > 0) {
      logInfo("[mosquitto-passwd] Đã xóa user phiên hết hạn", { count: removedCount });
      await reloadMqttBrokerInDocker();
    }
    
    return { success: true, removedCount };
  } catch (err) {
    logWarn("[mosquitto-passwd] Lỗi trong quá trình dọn dẹp passwd file", { message: err.message });
    return { skipped: true, reason: "error", error: err.message };
  }
}

module.exports = {
  passwdFilePath,
  passwdFileHasUser,
  upsertMqttBrokerUser,
  ensureMqttBrokerUser,
  cleanupExpiredUsers,
  WEBAPI_ROOT_FOR_TESTS: WEBAPI_ROOT,
};
