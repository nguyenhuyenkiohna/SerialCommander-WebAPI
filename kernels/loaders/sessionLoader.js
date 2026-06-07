const session = require("express-session");
const Redis = require("ioredis");

function buildSessionStore() {
  const sessionRedisUrl = process.env.SESSION_REDIS_URL || process.env.RATE_LIMIT_REDIS_URL;
  if (!sessionRedisUrl) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[session] Using memory session store in production. Set SESSION_REDIS_URL.");
    }
    return undefined;
  }

  try {
    const { RedisStore } = require("connect-redis");
    const redisClient = new Redis(sessionRedisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    return new RedisStore({ client: redisClient });
  } catch (error) {
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
