/**
 * Theo mặc định rate limit tắt khi NODE_ENV=test; chỉ bật cờ trong một case để không ảnh hưởng suite khác (cùng worker).
 */
delete process.env.RATE_LIMIT_REDIS_URL;

const express = require("express");
const request = require("supertest");

describe("simpleRateLimit 429 contract", () => {
  test("429 dùng sendError + RATE_LIMIT_EXCEEDED (+ Retry-After in-memory)", async () => {
    const prev = process.env.RATE_LIMIT_IN_TEST;
    try {
      process.env.RATE_LIMIT_IN_TEST = "1";
      jest.resetModules();
      const { createSimpleRateLimit } = require("../kernels/middlewares/simpleRateLimit");

      const app = express();
      const limit = createSimpleRateLimit({ windowMs: 60_000, maxRequests: 1 });
      app.get("/hit", limit, (_req, res) => res.status(204).send());

      await request(app).get("/hit").expect(204);

      const res = await request(app).get("/hit").expect(429);
      expect(res.body).toHaveProperty("message");
      expect(res.body).toHaveProperty("error");
      expect(res.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(res.headers["retry-after"]).toBeTruthy();
    } finally {
      if (prev !== undefined) process.env.RATE_LIMIT_IN_TEST = prev;
      else delete process.env.RATE_LIMIT_IN_TEST;
      jest.resetModules();
    }
  });
});
