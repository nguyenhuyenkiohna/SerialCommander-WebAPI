const { logWarn, logInfo } = require("../logging/appLogger");

/**
 * Factory Redis dùng chung (rate-limit, outbox, session, …).
 * @param {{ url?: string, label: string, enableOfflineQueue?: boolean }} opts
 */
function createRedisClient(opts) {
  const { url, label, enableOfflineQueue = false } = opts;
  if (!url) {
    return { client: null, mode: "none" };
  }

  try {
    const Redis = require("ioredis");
    const client = new Redis(url, {
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue,
    });

    let errorLogged = false;
    client.on("error", (err) => {
      if (!errorLogged) {
        logWarn(`[redis:${label}] connection error`, { message: err.message });
        errorLogged = true;
      }
    });

    client.on("connect", () => {
      logInfo(`[redis:${label}] connected`);
    });

    return { client, mode: "redis" };
  } catch (err) {
    logWarn(`[redis:${label}] ioredis unavailable`, { message: err.message || String(err) });
    return { client: null, mode: "unavailable" };
  }
}

module.exports = { createRedisClient };
