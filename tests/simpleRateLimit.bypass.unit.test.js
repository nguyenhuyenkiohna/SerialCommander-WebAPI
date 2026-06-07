process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_IN_TEST = "1";

jest.mock("../kernels/redis/redisClientFactory", () => ({
  createRedisClient: jest.fn().mockReturnValue({ client: null, mode: "none" }),
}));

jest.mock("../kernels/middlewares/errorHandler", () => ({
  sendError: jest.fn((res, status, message, code) => {
    res.status = status;
    res.body = { message, code };
    return res;
  }),
}));

const {
  createSimpleRateLimit,
  _resetRateLimitStateForTests,
} = require("../kernels/middlewares/simpleRateLimit");

describe("simpleRateLimit — bypass prevention", () => {
  beforeEach(() => {
    _resetRateLimitStateForTests();
  });

  it("dùng req.ip (không đọc X-Forwarded-For trực tiếp)", async () => {
    const middleware = createSimpleRateLimit({ windowMs: 60000, maxRequests: 1 });

    // Request 1 với ip=10.0.0.1 — PASS
    const req1 = {
      ip: "10.0.0.1",
      path: "/auth/login",
      headers: { "x-forwarded-for": "1.1.1.1" }, // XFF bị bỏ qua
      socket: {},
    };
    const res1 = { setHeader: jest.fn() };
    const next1 = jest.fn();
    await middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    // Request 2 cùng ip=10.0.0.1 nhưng XFF khác — bị block vì dùng req.ip
    const req2 = {
      ip: "10.0.0.1",
      path: "/auth/login",
      headers: { "x-forwarded-for": "9.9.9.9" }, // XFF khác nhưng ip giống
      socket: {},
    };
    const res2 = { setHeader: jest.fn() };
    const next2 = jest.fn();
    await middleware(req2, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.status).toBe(429);
  });

  it("per-user key khi req.user.id tồn tại", async () => {
    const middleware = createSimpleRateLimit({ windowMs: 60000, maxRequests: 1 });

    // User A — request 1: PASS
    const reqA1 = { ip: "10.0.0.1", path: "/api/data", user: { id: 42 }, socket: {} };
    const resA1 = { setHeader: jest.fn() };
    const nextA1 = jest.fn();
    await middleware(reqA1, resA1, nextA1);
    expect(nextA1).toHaveBeenCalled();

    // User B (khác id) cùng IP — PASS (khác key)
    const reqB = { ip: "10.0.0.1", path: "/api/data", user: { id: 99 }, socket: {} };
    const resB = { setHeader: jest.fn() };
    const nextB = jest.fn();
    await middleware(reqB, resB, nextB);
    expect(nextB).toHaveBeenCalled();

    // User A — request 2: BLOCK
    const reqA2 = { ip: "10.0.0.2", path: "/api/data", user: { id: 42 }, socket: {} };
    const resA2 = { setHeader: jest.fn() };
    const nextA2 = jest.fn();
    await middleware(reqA2, resA2, nextA2);
    expect(nextA2).not.toHaveBeenCalled();
    expect(resA2.status).toBe(429);
  });

  it("per-IP key khi chưa authn (không có req.user)", async () => {
    const middleware = createSimpleRateLimit({ windowMs: 60000, maxRequests: 1 });

    const req1 = { ip: "5.5.5.5", path: "/auth/register", socket: {} };
    const res1 = { setHeader: jest.fn() };
    const next1 = jest.fn();
    await middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    const req2 = { ip: "5.5.5.5", path: "/auth/register", socket: {} };
    const res2 = { setHeader: jest.fn() };
    const next2 = jest.fn();
    await middleware(req2, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.status).toBe(429);
  });

  it("skip middleware khi NODE_ENV=test và RATE_LIMIT_IN_TEST không phải '1'", async () => {
    const origValue = process.env.RATE_LIMIT_IN_TEST;
    process.env.RATE_LIMIT_IN_TEST = "0";

    const middleware = createSimpleRateLimit({ windowMs: 60000, maxRequests: 1 });
    const req = { ip: "1.1.1.1", path: "/test", socket: {} };
    const res = {};

    const next1 = jest.fn();
    await middleware(req, res, next1);
    expect(next1).toHaveBeenCalled();

    const next2 = jest.fn();
    await middleware(req, res, next2);
    expect(next2).toHaveBeenCalled(); // Không bị block vì skip

    process.env.RATE_LIMIT_IN_TEST = origValue;
  });
});
