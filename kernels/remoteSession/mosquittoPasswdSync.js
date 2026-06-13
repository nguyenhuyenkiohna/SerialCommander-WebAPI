/**
 * Đồng bộ sessionId + mqttPasswordToken vào Mosquitto password_file.
 * Khớp MqttContext: username=sessionId, password=mqttPasswordToken (plain, broker hash bằng PBKDF2).
 *
 * Dev Docker: ghi passwd bằng `docker exec … mosquitto_passwd` trong container broker
 * (hash khớp eclipse-mosquitto:2). KHÔNG dùng mosquitto_passwd Homebrew trên host — hash lệch broker.
 * Fallback: docker run image, host CLI, native PBKDF2.
 *
 * Lưu ý: MQTT_PASSWD_FILE nên là đường dẫn tương đối WebAPI root — resolve theo __dirname, không theo cwd.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { logInfo, logWarn } = require("../logging/appLogger");

// ── Native PBKDF2 hashing (Mosquitto 2.x format) ────────────────────────────
// Format: PBKDF2$sha512$<iterations>$<salt_base64>$<key_base64>
// Tham số mặc định khớp Mosquitto 2.0 (password_mosq.c: DEFAULT_ITERATIONS=901, SALT_LEN=12, KEY_LEN=64).
const PBKDF2_ITERATIONS = Number(process.env.MQTT_PASSWD_ITERATIONS || 901);
const PBKDF2_SALT_BYTES = 12;
const PBKDF2_KEY_BYTES = 64;
const PBKDF2_DIGEST = "sha512";

/**
 * Tính Mosquitto passwd hash bằng PBKDF2-SHA512 trong Node.js.
 * Không gọi subprocess — password không xuất hiện trong process args hay cmdline.
 */
function hashMosquittoPassword(password) {
  const salt = crypto.randomBytes(PBKDF2_SALT_BYTES);
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BYTES, PBKDF2_DIGEST);
  return `PBKDF2$sha512$${PBKDF2_ITERATIONS}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * Ghi entry vào passwd file dùng native PBKDF2 — không cần mosquitto_passwd CLI.
 * Dùng atomic rename (write → tmp → rename) để tránh partial-write corruption.
 */
function writePasswdEntryNative(absFilePath, sessionId, password, createNew) {
  const hash = hashMosquittoPassword(password);
  const newEntry = `${sessionId}:${hash}`;

  let lines = [];
  if (!createNew) {
    try {
      const existing = fs.readFileSync(absFilePath, "utf8");
      lines = existing.split("\n").filter(Boolean);
    } catch {
      // file không tồn tại → tạo mới
    }
  }

  const userPrefix = `${sessionId}:`;
  const idx = lines.findIndex((l) => l.startsWith(userPrefix));
  if (idx >= 0) {
    lines[idx] = newEntry;
  } else {
    lines.push(newEntry);
  }

  const content = lines.join("\n") + "\n";
  const tmpPath = `${absFilePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, content, { mode: 0o600 });
  fs.renameSync(tmpPath, absFilePath);
}

/**
 * Xóa entry khỏi passwd file (native).
 */
function removePasswdEntryNative(absFilePath, sessionId) {
  if (!fs.existsSync(absFilePath)) return;
  const existing = fs.readFileSync(absFilePath, "utf8");
  const userPrefix = `${sessionId}:`;
  const lines = existing.split("\n").filter((l) => Boolean(l) && !l.startsWith(userPrefix));
  const content = lines.join("\n") + (lines.length ? "\n" : "");
  const tmpPath = `${absFilePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, content, { mode: 0o600 });
  fs.renameSync(tmpPath, absFilePath);
}

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

/**
 * Debounce window để gom nhiều yêu cầu HUP trong cùng khoảng thời gian.
 * N phiên tạo đồng thời → chỉ 1 HUP duy nhất thay vì N×1200ms.
 * Cấu hình qua MQTT_BROKER_HUP_DEBOUNCE_MS (default 200ms).
 */
const HUP_DEBOUNCE_MS = Number(process.env.MQTT_BROKER_HUP_DEBOUNCE_MS || 200);
let _hupDebounceTimer = null;
const _hupWaiters = [];

/**
 * Lên lịch HUP một lần duy nhất trong cửa sổ debounce.
 * Mọi caller trong cùng cửa sổ đều chờ cùng 1 HUP rồi mới return.
 */
function scheduleHupOnce() {
  return new Promise((resolve) => {
    _hupWaiters.push(resolve);
    if (_hupDebounceTimer !== null) return; // đã có timer đang chạy, chỉ cần đăng ký waiter
    _hupDebounceTimer = setTimeout(async () => {
      _hupDebounceTimer = null;
      const waiters = _hupWaiters.splice(0);
      try {
        await reloadMqttBrokerInDocker();
        await new Promise((r) => setTimeout(r, MOSQUITTO_RELOAD_DELAY_MS));
      } finally {
        for (const w of waiters) w();
      }
    }, HUP_DEBOUNCE_MS);
  });
}

/** Test helper: reset trạng thái debounce giữa các test cases. */
function _resetHupStateForTests() {
  if (_hupDebounceTimer !== null) {
    clearTimeout(_hupDebounceTimer);
    _hupDebounceTimer = null;
  }
  _hupWaiters.splice(0);
}

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
const DEFAULT_CONTAINER_PASSWD_PATH = "/mosquitto/config/passwd";

function isDockerCliEnabled() {
  return process.env.MQTT_DOCKER_CLI_ENABLED === "true";
}

function containerPasswdPath() {
  return (process.env.MQTT_PASSWD_CONTAINER_PATH || DEFAULT_CONTAINER_PASSWD_PATH).trim();
}

function dockerBrokerContainerCandidates() {
  const explicit = (
    process.env.MQTT_BROKER_HUP_CONTAINER ||
    process.env.MQTT_BROKER_RELOAD_CONTAINER ||
    ""
  ).trim();
  if (explicit) return [explicit];
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test") return [];
  return DEFAULT_DEV_HUP_CONTAINERS;
}

async function reloadMqttBrokerInDocker() {
  if (!isDockerCliEnabled()) {
    logWarn(
      "[mosquitto-passwd] MQTT_DOCKER_CLI_ENABLED≠true — bỏ qua docker HUP/restart (không mount docker.sock).",
      { code: "MQTT_DOCKER_CLI_DISABLED" }
    );
    return;
  }

  const candidates = dockerBrokerContainerCandidates();
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
 * Ghi passwd trong container broker đang chạy — hash khớp đúng phiên bản Mosquitto đang listen.
 */
/** Broker đọc passwd trong container — bind mount macOS đôi khi lệch so với file host. */
async function passwdVisibleInBrokerContainer(sessionId) {
  if (!isDockerCliEnabled()) return true;
  const passwdInContainer = containerPasswdPath();
  for (const name of dockerBrokerContainerCandidates()) {
    try {
      await execFileAsync(
        "docker",
        ["exec", name, "grep", "-q", `^${sessionId}:`, passwdInContainer],
        { timeout: 8000 }
      );
      return true;
    } catch {
      /* thử container khác */
    }
  }
  return false;
}

/** Docker Desktop (macOS): bind mount passwd có thể lệch host ↔ container — mirror sau khi ghi trong container. */
async function mirrorContainerPasswdToHost() {
  const file = passwdFilePath();
  if (!file || !isDockerCliEnabled()) return;
  const passwdInContainer = containerPasswdPath();
  for (const name of dockerBrokerContainerCandidates()) {
    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["exec", name, "cat", passwdInContainer],
        { timeout: 10000, maxBuffer: 2 * 1024 * 1024 }
      );
      const tmpPath = `${file}.mirror.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmpPath, stdout, { mode: 0o600 });
      fs.renameSync(tmpPath, file);
      return;
    } catch {
      /* thử container khác */
    }
  }
}

async function upsertViaDockerExecPasswd(sessionId, mqttPasswordToken) {
  if (!isDockerCliEnabled()) {
    throw new Error("MQTT_DOCKER_CLI_ENABLED is not true");
  }
  const passwdInContainer = containerPasswdPath();
  const candidates = dockerBrokerContainerCandidates();
  if (!candidates.length) {
    throw new Error("no docker broker container configured");
  }
  let lastErr;
  for (const name of candidates) {
    try {
      await execFileAsync(
        "docker",
        ["exec", name, "mosquitto_passwd", "-b", passwdInContainer, sessionId, mqttPasswordToken],
        { timeout: 15000 }
      );
      if (!(await passwdVisibleInBrokerContainer(sessionId))) {
        throw new Error("user not visible in container passwd after mosquitto_passwd");
      }
      await mirrorContainerPasswdToHost();
      logInfo("[mosquitto-passwd] đã ghi user phiên (docker exec mosquitto_passwd)", {
        sessionId,
        container: name,
      });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("docker exec mosquitto_passwd failed");
}

/**
 * mosquitto_passwd qua eclipse-mosquitto image khi không exec được vào container.
 */
async function upsertViaDockerPasswd(absFilePath, sessionId, mqttPasswordToken, createNew) {
  if (!isDockerCliEnabled()) {
    throw new Error("MQTT_DOCKER_CLI_ENABLED is not true");
  }
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
 *
 * Thứ tự ưu tiên (MQTT_DOCKER_CLI_ENABLED):
 *   1. docker exec mosquitto_passwd (cùng image broker)
 *   2. docker run mosquitto_passwd
 *   3. host CLI → native PBKDF2
 * Không bật Docker CLI: host CLI → native PBKDF2
 *
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

  const tryDockerRunPasswd = async (cause) => {
    try {
      await upsertViaDockerPasswd(file, sessionId, mqttPasswordToken, createNew);
      logInfo("[mosquitto-passwd] đã ghi user phiên (docker run mosquitto_passwd)", { sessionId });
      return { synced: true, viaDocker: true, needsReload: true };
    } catch (dockerErr) {
      logWarn("[mosquitto-passwd] docker run mosquitto_passwd thất bại", {
        sessionId,
        cause,
        message: dockerErr.message,
        file,
      });
      return null;
    }
  };

  if (isDockerCliEnabled()) {
    try {
      await upsertViaDockerExecPasswd(sessionId, mqttPasswordToken);
      if (await passwdVisibleInBrokerContainer(sessionId)) {
        return { synced: true, needsReload: true, viaDockerExec: true };
      }
      logWarn("[mosquitto-passwd] docker exec xong nhưng broker chưa thấy user — ghi lại", {
        sessionId,
      });
      await upsertViaDockerExecPasswd(sessionId, mqttPasswordToken);
      if (await passwdVisibleInBrokerContainer(sessionId)) {
        return { synced: true, needsReload: true, viaDockerExec: true, retried: true };
      }
    } catch (execErr) {
      logWarn("[mosquitto-passwd] docker exec mosquitto_passwd thất bại — thử docker run", {
        sessionId,
        message: execErr.message || String(execErr),
      });
    }
    const dockerRunResult = await tryDockerRunPasswd("exec_failed");
    if (dockerRunResult) {
      if (!(await passwdVisibleInBrokerContainer(sessionId))) {
        try {
          await upsertViaDockerExecPasswd(sessionId, mqttPasswordToken);
        } catch (retryErr) {
          logWarn("[mosquitto-passwd] docker run xong nhưng container vẫn thiếu user", {
            sessionId,
            message: retryErr.message || String(retryErr),
          });
        }
      }
      return dockerRunResult;
    }
  } else {
    try {
      await upsertViaNativePasswd(file, sessionId, mqttPasswordToken, createNew);
      logInfo("[mosquitto-passwd] đã ghi user phiên (host mosquitto_passwd)", { sessionId });
      return { synced: true, needsReload: true };
    } catch (cliErr) {
      logWarn("[mosquitto-passwd] host mosquitto_passwd thất bại", {
        sessionId,
        message: cliErr.message || String(cliErr),
      });
    }
  }

  // ── Fallback: native PBKDF2 (một số broker từ chối — chỉ dùng khi không có CLI) ──
  try {
    writePasswdEntryNative(file, sessionId, mqttPasswordToken, createNew);
    if (isDockerCliEnabled()) {
      try {
        await upsertViaDockerExecPasswd(sessionId, mqttPasswordToken);
      } catch (syncErr) {
        logWarn("[mosquitto-passwd] native ghi host OK nhưng docker exec đồng bộ thất bại", {
          sessionId,
          message: syncErr.message || String(syncErr),
        });
      }
    }
    logWarn(
      "[mosquitto-passwd] đã ghi user phiên (native PBKDF2 fallback) — cài mosquitto_passwd hoặc bật MQTT_DOCKER_CLI_ENABLED",
      { sessionId }
    );
    return { synced: true, needsReload: true, viaNativeFallback: true };
  } catch (nativeErr) {
    logWarn("[mosquitto-passwd] mọi phương thức ghi passwd đều thất bại", {
      sessionId,
      message: nativeErr.message || String(nativeErr),
    });
    return { skipped: true, reason: "all_methods_failed", error: nativeErr.message };
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
 * Station verify: luôn upsert passwd để đồng bộ token Redis ↔ broker (sửa hash stale).
 * HUP được debounce — nhiều join đồng thời chỉ reload broker một lần.
 */
async function ensureMqttBrokerUser(sessionId, mqttPasswordToken) {
  const alreadyPresent = passwdFileHasUser(sessionId);
  const result = await upsertMqttBrokerUser(sessionId, mqttPasswordToken);
  return {
    ...result,
    alreadyPresent,
    passwdReloaded: result.needsReload === true,
  };
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
    // Dùng debounced HUP: nhiều phiên tạo đồng thời chia sẻ 1 HUP duy nhất.
    // Thay vì N×1200ms, tất cả hoàn tất sau ~(HUP_DEBOUNCE_MS + MOSQUITTO_RELOAD_DELAY_MS).
    await scheduleHupOnce();
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
 * Thu hồi credential broker NGAY khi host kết thúc phiên:
 * xóa user khỏi passwd file (serialize qua enqueueWrite) rồi HUP Mosquitto.
 * Sau HUP, client mới không thể CONNECT bằng credential phiên cũ.
 * Idempotent — user không có trong file vẫn trả removed=true.
 */
async function removeMqttBrokerUser(sessionId) {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return { skipped: true, reason: "invalid_session_id" };
  }
  const file = passwdFilePath();
  if (!file) return { skipped: true, reason: "MQTT_PASSWD_FILE không cấu hình" };

  const removed = await enqueueWrite(async () => {
    if (!passwdFileHasUser(sessionId)) return true;
    try {
      removePasswdEntryNative(file, sessionId);
      return true;
    } catch {
      try {
        await removeViaNativePasswd(file, sessionId);
        return true;
      } catch {
        try {
          await removeViaDockerPasswd(file, sessionId);
          return true;
        } catch (dockerErr) {
          logWarn("[mosquitto-passwd] Thu hồi user phiên thất bại (native + CLI + docker)", {
            sessionId,
            message: dockerErr.message,
          });
          return false;
        }
      }
    }
  });

  if (!removed) return { removed: false };
  await scheduleHupOnce();
  logInfo("[mosquitto-passwd] đã thu hồi user phiên + HUP broker", { sessionId });
  return { removed: true };
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
          // Thử native trước (không subprocess), rồi CLI, rồi Docker
          try {
            removePasswdEntryNative(file, sessionId);
            return true;
          } catch {
            try {
              await removeViaNativePasswd(file, sessionId);
              return true;
            } catch {
              try {
                await removeViaDockerPasswd(file, sessionId);
                return true;
              } catch (dockerErr) {
                logWarn("[mosquitto-passwd] Xóa user thất bại (native + CLI + docker)", { sessionId, message: dockerErr.message });
                return false;
              }
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
  removeMqttBrokerUser,
  cleanupExpiredUsers,
  WEBAPI_ROOT_FOR_TESTS: WEBAPI_ROOT,
  _resetHupStateForTests,
  _getHupDebounceMs: () => HUP_DEBOUNCE_MS,
};
