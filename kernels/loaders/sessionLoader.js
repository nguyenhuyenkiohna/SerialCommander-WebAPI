const session = require("express-session");
const Redis = require("ioredis");

function buildSessionStore() {
  // Jest/integration tests: memory store — tránh TCPWRAP open handle từ ioredis
  if (process.env.NODE_ENV === "test") {
    return undefined;
  }

  const sessionRedisUrl = process.env.SESSION_REDIS_URL || process.env.RATE_LIMIT_REDIS_URL;
  if (!sessionRedisUrl) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "❌ CRITICAL: SESSION_REDIS_URL (or RATE_LIMIT_REDIS_URL) is required in production. Exiting..."
      );
      process.exit(1);
    }
    return undefined;
  }

  try {
    const { RedisStore } = require("connect-redis");
    const redisClient = new Redis(sessionRedisUrl, {
      // connect-redis + ioredis: null tránh lỗi khi ghi session trước khi socket sẵn sàng
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      connectTimeout: 10000,
    });
    return new RedisStore({ client: redisClient });
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "❌ CRITICAL: Cannot initialize Redis session store in production:",
        error.message
      );
      process.exit(1);
    }
    console.warn("[session] Cannot initialize Redis session store:", error.message);
    return undefined;
  }
}

function configureSession(app, sessionSecret) {
  app.use(
    session({
      secret: sessionSecret,
      store: buildSessionStore(),
      resave: false,
      saveUninitialized: false,
      proxy: process.env.NODE_ENV === "production",
      name: process.env.SESSION_COOKIE_NAME || "sid",
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000,
      },
    })
  );
}

module.exports = { configureSession };
