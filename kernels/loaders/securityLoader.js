const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const path = require("path");
const { requestTraceMiddleware } = require("../middlewares/requestTraceMiddleware");

function isDevPrivateNetworkOrigin(origin) {
  if (process.env.NODE_ENV === "production") return false;
  const normalized = origin.replace(/\/+$/, "");
  if (
    normalized.startsWith("http://localhost:") ||
    normalized.startsWith("http://127.0.0.1:")
  ) {
    return true;
  }
  try {
    const { hostname, protocol } = new URL(normalized);
    if (protocol !== "http:" && protocol !== "https:") return false;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  } catch {
    return false;
  }
  return false;
}

function configureSecurity(app) {
  app.disable("x-powered-by");

  // Tin tưởng 1 cấp reverse proxy (nginx/caddy) để req.ip nhận IP client thật từ XFF.
  // Không set → req.ip = socket IP (đúng khi không có proxy), set 1 → đúng khi sau 1 proxy.
  if (process.env.TRUST_PROXY != null) {
    const v = process.env.TRUST_PROXY;
    app.set("trust proxy", v === "true" ? true : v === "false" ? false : (Number(v) || v));
  } else if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  app.use(requestTraceMiddleware);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  app.use(express.json());

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);

        const configured = process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "http://localhost:5173";
        const allowlist = configured
          .split(",")
          .map((x) => x.trim().replace(/\/+$/, ""))
          .filter(Boolean);
        const normalizedOrigin = origin.replace(/\/+$/, "");

        if (allowlist.includes(normalizedOrigin)) return cb(null, true);

        if (isDevPrivateNetworkOrigin(normalizedOrigin)) {
          return cb(null, true);
        }

        return cb(null, false);
      },
      credentials: true,
      exposedHeaders: ["X-Request-Id"],
    })
  );

  app.use("/uploads", express.static(path.join(__dirname, "../../uploads")));
}

module.exports = { configureSecurity, isDevPrivateNetworkOrigin };
