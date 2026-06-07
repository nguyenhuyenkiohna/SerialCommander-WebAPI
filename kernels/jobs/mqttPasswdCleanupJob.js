const { cleanupExpiredUsers } = require("../../kernels/remoteSession/mosquittoPasswdSync");
const { getActiveSessionIds } = require("../../kernels/remoteSession/remoteSessionStore");
const { logInfo, logError } = require("../logging/appLogger");

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function runCleanupOnce() {
  try {
    await cleanupExpiredUsers(getActiveSessionIds);
  } catch (err) {
    logError("[mqttPasswdCleanupJob] Lỗi khi dọn dẹp passwd", { message: err.message });
  }
}

function startMqttPasswdCleanupJob() {
  if (process.env.NODE_ENV === "test") return;
  
  logInfo("[mqttPasswdCleanupJob] Bắt đầu cron job dọn dẹp user MQTT hết hạn", { intervalMs: INTERVAL_MS });
  
  // Run once immediately on startup, but give the broker a moment to start
  setTimeout(runCleanupOnce, 15000);
  
  setInterval(runCleanupOnce, INTERVAL_MS);
}

module.exports = {
  startMqttPasswdCleanupJob,
  runCleanupOnce
};