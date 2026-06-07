process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-public";
process.env.SESSION_SECRET = "test-session-secret-public";
process.env.FRONTEND_URL = "http://localhost:5173";

require("rootpath")();

jest.mock("configs/passport", () => ({
  initialize: () => (_req, _res, next) => next(),
  session: () => (_req, _res, next) => next(),
  authenticate: () => (_req, _res, next) => next(),
}));

const request = require("supertest");
const app = require("index");

describe("Public success contract", () => {
  test("GET / trả success contract chuẩn", async () => {
    const res = await request(app).get("/").expect(200);
    expect(typeof res.body.message).toBe("string");
    expect(res.body).toHaveProperty("status", "running");
    expect(res.body).toHaveProperty("endpoints.auth");
    expect(res.body.trace_id).toBeTruthy();
    expect(res.headers["x-request-id"]).toBe(res.body.trace_id);
  });

  test("GET /health trả trạng thái DB (200 hoặc 503 nếu DB down)", async () => {
    const res = await request(app).get("/health");
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("db");
    expect(res.body).toHaveProperty("redis");
    expect(res.body).toHaveProperty("firebase");
    expect(res.body).toHaveProperty("mqtt");
    expect(res.body.trace_id).toBeTruthy();
  });

  test("GET / tôn trọng X-Request-Id từ client", async () => {
    const res = await request(app)
      .get("/")
      .set("X-Request-Id", "ops-correlation-xyz-01")
      .expect(200);
    expect(res.body.trace_id).toBe("ops-correlation-xyz-01");
    expect(res.headers["x-request-id"]).toBe("ops-correlation-xyz-01");
  });
});
