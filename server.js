require("./configs/bootstrapEnv");
const { initTelemetry } = require("./kernels/telemetry/initOtel");
initTelemetry();

const fs = require("fs");
const path = require("path");
const { logError, logInfo } = require("./kernels/logging/appLogger");
const app = require("./index");
const { sequelize } = require("./models");
const { isFirebaseReady } = require("./kernels/firebaseAdmin");
const { checkSchemaVersion } = require("./kernels/dbSchemaCheck");
const { assertDatabaseEnvLoaded } = require("./configs/databaseEnv");
const { startAuthCodeCleanupJob } = require("./kernels/jobs/authCodeCleanupJob");
const { startScenarioOutboxWorker } = require("./kernels/syncJob");
const { startMqttPasswdCleanupJob } = require("./kernels/jobs/mqttPasswdCleanupJob");
const { logEmailConfigAtStartup } = require("./utils/emailConfig");

const port = process.env.PORT || 2999;
const host = process.env.HOST || "0.0.0.0";

function ensureUploadsDirectory() {
  const uploadsDir = path.join(__dirname, "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    logInfo("[uploads] Đã tạo thư mục", { dir: uploadsDir });
  }
}

async function startServer() {
  try {
    ensureUploadsDirectory();
    assertDatabaseEnvLoaded();

    await sequelize.authenticate();
    logInfo("[db] Database connection has been established successfully.");

    await checkSchemaVersion(sequelize);

    if (process.env.NODE_ENV !== "production") {
      await sequelize.sync({ alter: false });
    } else {
      logInfo(
        "[db] Nhắc deploy: áp dụng migrations/*.sql thủ công trên server trước khi bật phiên bản mới.",
        {}
      );
    }

    logInfo(
      isFirebaseReady()
        ? "[firebase] Đã kết nối Firestore + Storage (service account hợp lệ)."
        : "[firebase] Chưa kết nối — kiểm tra FIREBASE_SERVICE_ACCOUNT_PATH và file JSON."
    );

    logEmailConfigAtStartup();

    app.listen(port, host, () => {
      console.log(`Server running at http://${host}:${port}`);
      startAuthCodeCleanupJob();
      startScenarioOutboxWorker();
      startMqttPasswdCleanupJob();
    });
  } catch (error) {
    const host = process.env.DATABASE_HOST || "localhost";
    const port = process.env.DATABASE_PORT || 3306;
    const hint =
      error.name === "SequelizeConnectionRefusedError" ||
      /ECONNREFUSED|connect ENOENT/i.test(String(error.message))
        ? `[db] Không kết nối MySQL tại ${host}:${port}. Chạy: make infra-up (Docker) và đảm bảo DATABASE_PORT khớp cổng map (docker port sc-mysql-demo). Sau đó: make migrate`
        : null;
    logError("Unable to connect to the database or start server", {
      message: error.message || String(error),
      stack: error.stack,
      hint,
    });
    if (hint) {
      console.error(hint);
    }
    process.exit(1);
  }
}

startServer();
