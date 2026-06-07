const helmet = require("helmet");
const fs = require("fs");
const path = require("path");
const { passwdFilePath } = require("../remoteSession/mosquittoPasswdSync");

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function configureRoutes(app, deps) {
  const {
    router,
    swaggerUIServe,
    swaggerUISetup,
    authRoutes,
    userRoutes,
    uploadRoutes,
    firebaseRoutes,
    remoteRoutes,
    youtubeRoutes,
    sendSuccess,
    notFoundHandler,
    errorHandler,
  } = deps;

  app.get("/health", async (_req, res) => {
    const payload = {
      status: "ok",
      db: "unknown",
      redis: "skipped",
      firebase: "skipped",
      mqtt: "skipped",
    };
    try {
      const { sequelize } = require("../../models");
      await sequelize.authenticate();
      payload.db = "ok";
    } catch (err) {
      payload.status = "degraded";
      payload.db = "fail";
      payload.dbError = err.message || String(err);
      return sendSuccess(res, 503, "API degraded — database unreachable", payload);
    }

    const redisUrl =
      process.env.RATE_LIMIT_REDIS_URL ||
      process.env.SCENARIO_OUTBOX_REDIS_URL ||
      process.env.REMOTE_SESSION_REDIS_URL;
    if (redisUrl) {
      try {
        const Redis = require("ioredis");
        const probe = new Redis(redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 2000,
        });
        await probe.connect();
        await probe.ping();
        payload.redis = "ok";
        await probe.quit();
      } catch (err) {
        payload.status = "degraded";
        payload.redis = "fail";
        payload.redisError = err.message || String(err);
        return sendSuccess(res, 503, "API degraded — redis unreachable", payload);
      }
    }

    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      try {
        const { isFirebaseReady, getFirestore } = require("../firebaseAdmin");
        if (!isFirebaseReady()) {
          throw new Error("Firebase Admin chưa khởi tạo được");
        }
        const firestore = getFirestore();
        if (!firestore) {
          throw new Error("Firestore chưa sẵn sàng");
        }
        await withTimeout(firestore.listCollections(), 2000, "firebase");
        payload.firebase = "ok";
      } catch (err) {
        payload.status = "degraded";
        payload.firebase = "fail";
        payload.firebaseError = err.message || String(err);
        return sendSuccess(res, 503, "API degraded — firebase unreachable", payload);
      }
    }

    if (process.env.MQTT_PASSWD_FILE) {
      try {
        const mqttPasswdFile = passwdFilePath();
        if (!mqttPasswdFile) {
          throw new Error("MQTT_PASSWD_FILE chưa được cấu hình hợp lệ");
        }
        const mqttDir = path.dirname(mqttPasswdFile);
        fs.accessSync(mqttDir, fs.constants.R_OK | fs.constants.W_OK);
        payload.mqtt = "ok";
      } catch (err) {
        payload.status = "degraded";
        payload.mqtt = "fail";
        payload.mqttError = err.message || String(err);
        return sendSuccess(res, 503, "API degraded — mqtt passwd sync unavailable", payload);
      }
    }

    return sendSuccess(res, 200, "Serial Commander API healthy", payload);
  });

  app.get("/", (_req, res) =>
    sendSuccess(res, 200, "Serial Commander API Server", {
      version: "1.0.0",
      endpoints: {
        docs: "/api-docs",
        auth: "/api/auth",
        user: "/api/user",
        config: "/scenarios",
        upload: "/api/upload",
        firebase: "/api/firebase",
        remote: "/api/remote",
        youtube: "/api/youtube",
      },
      status: "running",
    })
  );

  app.use("/", router);
  app.use(
    "/api-docs",
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
    swaggerUIServe,
    swaggerUISetup
  );
  app.use("/api/auth", authRoutes);
  app.use("/api/user", userRoutes);
  app.use("/api/upload", uploadRoutes);
  app.use("/api/firebase", firebaseRoutes);
  app.use("/api/remote", remoteRoutes);
  app.use("/api/youtube", youtubeRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
}

module.exports = { configureRoutes };
