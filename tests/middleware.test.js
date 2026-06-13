/**
 * Unit Tests - JWT Middleware & CORS
 *
 * Chạy: npm test -- --testPathPattern=middleware.test.js
 */

process.env.NODE_ENV = "test";
// ≥16 ký tự: khi test tạm NODE_ENV=production, getJwtSecret() bắt buộc secret đủ dài
process.env.JWT_SECRET = "test-jwt-secret-for-jest-ok";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.FRONTEND_URLS = "http://localhost:5173,https://serial.toolhub.app";

require("rootpath")();

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const { verifyToken, verifyAdmin } = require("kernels/middlewares/authMiddleware");
const { isDevPrivateNetworkOrigin } = require("kernels/loaders/securityLoader");

// ─── Setup test app ──────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());

  // CORS config (mirror cấu hình trong securityLoader.js)
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const configured =
          process.env.FRONTEND_URLS ||
          process.env.FRONTEND_URL ||
          "http://localhost:5173";
        const allowlist = configured
          .split(",")
          .map((x) => x.trim().replace(/\/+$/, ""))
          .filter(Boolean);
        const normalizedOrigin = origin.replace(/\/+$/, "");
        if (allowlist.includes(normalizedOrigin)) return cb(null, true);
        if (isDevPrivateNetworkOrigin(normalizedOrigin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    })
  );

  // Protected route for testing
  app.get("/protected", verifyToken, (req, res) => {
    res.json({ message: "OK", user: req.user });
  });

  // Admin route for testing
  app.get("/admin", verifyToken, verifyAdmin, (req, res) => {
    res.json({ message: "Admin OK" });
  });

  return app;
}

const app = buildApp();

// ─── JWT MIDDLEWARE TESTS ────────────────────────────────────────────────────

describe("verifyToken middleware", () => {
  test("✅ Cho phép truy cập khi token hợp lệ", async () => {
    const token = jwt.sign(
      { id: 1, username: "testuser", role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 1, username: "testuser" });
  });

  test("✅ Cho phép truy cập khi JWT trong HttpOnly cookie sc_auth_token", async () => {
    const token = jwt.sign(
      { id: 7, username: "cookieuser", role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const res = await request(app)
      .get("/protected")
      .set("Cookie", `sc_auth_token=${encodeURIComponent(token)}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 7, username: "cookieuser" });
  });

  test("✅ Cookie được ưu tiên hơn Bearer khi cả hai có mặt", async () => {
    const cookieToken = jwt.sign(
      { id: 10, username: "from-cookie", role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    const bearerToken = jwt.sign(
      { id: 99, username: "from-bearer", role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const res = await request(app)
      .get("/protected")
      .set("Cookie", `sc_auth_token=${encodeURIComponent(cookieToken)}`)
      .set("Authorization", `Bearer ${bearerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 10, username: "from-cookie" });
  });

  test("❌ Từ chối khi không có Authorization header", async () => {
    const res = await request(app).get("/protected");

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Token không được cung cấp/i);
  });

  test("❌ Từ chối khi token sai hoặc giả mạo", async () => {
    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer invalid.token.here");

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Token không hợp lệ/i);
  });

  test("❌ Từ chối khi token đã hết hạn", async () => {
    const expiredToken = jwt.sign(
      { id: 1, username: "testuser", role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "-1s" } // đã hết hạn
    );

    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Token không hợp lệ/i);
  });

  test("❌ Từ chối khi JWT_SECRET khác nhau (token bị giả)", async () => {
    const fakeToken = jwt.sign(
      { id: 1, username: "hacker", role: "admin" },
      "wrong-secret-key"
    );

    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${fakeToken}`);

    expect(res.status).toBe(401);
  });

  test("❌ Production: Bearer bị tắt khi không có cookie", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevBearer = process.env.ALLOW_BEARER_AUTH;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.ALLOW_BEARER_AUTH;

      const token = jwt.sign(
        { id: 2, username: "bearer-only", role: "user" },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      const res = await request(app)
        .get("/protected")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe("BEARER_AUTH_DISABLED");
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevBearer !== undefined) process.env.ALLOW_BEARER_AUTH = prevBearer;
      else delete process.env.ALLOW_BEARER_AUTH;
    }
  });

  test("✅ Production: HttpOnly cookie vẫn hoạt động khi Bearer tắt", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevBearer = process.env.ALLOW_BEARER_AUTH;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.ALLOW_BEARER_AUTH;

      const token = jwt.sign(
        { id: 3, username: "cookie-prod", role: "user" },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      const res = await request(app)
        .get("/protected")
        .set("Cookie", `sc_auth_token=${encodeURIComponent(token)}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ id: 3, username: "cookie-prod" });
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevBearer !== undefined) process.env.ALLOW_BEARER_AUTH = prevBearer;
      else delete process.env.ALLOW_BEARER_AUTH;
    }
  });
});

// ─── ADMIN MIDDLEWARE TESTS ──────────────────────────────────────────────────

describe("verifyAdmin middleware", () => {
  test("✅ Admin có thể truy cập admin route", async () => {
    const token = jwt.sign(
      { id: 1, username: "adminuser", role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const res = await request(app)
      .get("/admin")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Admin OK");
  });

  test("❌ User thường bị từ chối truy cập admin route", async () => {
    const token = jwt.sign(
      { id: 2, username: "regularuser", role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const res = await request(app)
      .get("/admin")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/admin/i);
  });
});

// ─── CORS TESTS ──────────────────────────────────────────────────────────────

describe("CORS configuration", () => {
  test("✅ Cho phép origin hợp lệ trong whitelist", async () => {
    const res = await request(app)
      .get("/protected")
      .set("Origin", "http://localhost:5173")
      .set("Authorization", "Bearer invalid"); // sẽ fail 401 nhưng CORS OK

    // CORS header phải tồn tại
    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173"
    );
  });

  test("✅ Cho phép production origin hợp lệ", async () => {
    const res = await request(app)
      .get("/protected")
      .set("Origin", "https://serial.toolhub.app")
      .set("Authorization", "Bearer invalid");

    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://serial.toolhub.app"
    );
  });

  test("✅ Cho phép localhost bất kỳ port (non-production)", async () => {
    // NODE_ENV=test, không phải production → localhost:XXXX được cho phép
    const res = await request(app)
      .get("/protected")
      .set("Origin", "http://localhost:3000")
      .set("Authorization", "Bearer invalid");

    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000"
    );
  });

  test("✅ Cho phép LAN IP khi dev (vite --host 0.0.0.0)", async () => {
    const res = await request(app)
      .get("/protected")
      .set("Origin", "http://192.168.5.175:5173")
      .set("Authorization", "Bearer invalid");

    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://192.168.5.175:5173"
    );
  });

  test("❌ Chặn origin không được phép trong production", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const prodApp = buildApp(); // rebuild với NODE_ENV=production
    const res = await request(prodApp)
      .get("/protected")
      .set("Origin", "https://evil-site.com")
      .set("Authorization", "Bearer invalid");

    // CORS error → không có allow-origin header hoặc response lỗi
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();

    process.env.NODE_ENV = originalEnv;
  });

  test("✅ Cho phép request không có Origin (server-to-server, Postman)", async () => {
    const token = jwt.sign(
      { id: 1, username: "testuser", role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    // Không set Origin header → coi như server-to-server

    expect(res.status).toBe(200);
  });
});

// ─── JWT TOKEN STRUCTURE TESTS ───────────────────────────────────────────────

describe("JWT token structure", () => {
  test("✅ Token chứa đủ các field cần thiết (id, username, role)", () => {
    const token = jwt.sign(
      { id: 5, username: "user5", role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    expect(decoded).toHaveProperty("id", 5);
    expect(decoded).toHaveProperty("username", "user5");
    expect(decoded).toHaveProperty("role", "user");
    expect(decoded).toHaveProperty("exp"); // expiry tồn tại
    expect(decoded).toHaveProperty("iat"); // issued-at tồn tại
  });

  test("✅ Token hết hạn sau 1 ngày", () => {
    const token = jwt.sign(
      { id: 1, username: "test", role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    const decoded = jwt.decode(token);
    const oneDayInSeconds = 24 * 60 * 60;
    const diff = decoded.exp - decoded.iat;

    // Cho phép sai số nhỏ
    expect(diff).toBeCloseTo(oneDayInSeconds, -1);
  });
});
