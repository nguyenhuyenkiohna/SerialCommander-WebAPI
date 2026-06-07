process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_IN_TEST = "1";

describe("simpleRateLimit Redis preference", () => {
  afterEach(() => {
    jest.resetModules();
    delete process.env.RATE_LIMIT_REDIS_URL;
  });

  test("ưu tiên Redis khi có URL và incr thành công", async () => {
    process.env.RATE_LIMIT_REDIS_URL = "redis://127.0.0.1:6379/0";

    const mockIncr = jest.fn().mockResolvedValue(1);
    const mockPexpire = jest.fn().mockResolvedValue(1);
    const mockPttl = jest.fn().mockResolvedValue(60_000);
    const mockConnect = jest.fn().mockResolvedValue(undefined);

    jest.mock("ioredis", () =>
      jest.fn().mockImplementation(() => ({
        status: "ready",
        connect: mockConnect,
        incr: mockIncr,
        pexpire: mockPexpire,
        pttl: mockPttl,
        on: jest.fn(),
      }))
    );

    jest.resetModules();
    const {
      createSimpleRateLimit,
      getRateLimitStoreMode,
      _resetRateLimitStateForTests,
    } = require("../kernels/middlewares/simpleRateLimit");

    _resetRateLimitStateForTests();
    expect(getRateLimitStoreMode()).toBe("redis");

    const express = require("express");
    const request = require("supertest");
    const app = express();
    app.get("/t", createSimpleRateLimit({ windowMs: 60_000, maxRequests: 5 }), (_req, res) =>
      res.status(204).send()
    );

    await request(app).get("/t").expect(204);
    expect(mockIncr).toHaveBeenCalled();
  });
});
