process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-for-validation";

require("rootpath")();

const request = require("supertest");
const express = require("express");
const { body } = require("express-validator");
const { validate } = require("kernels/validations");

describe("Validation contract integration", () => {
  test("422 trả error contract khi validation fail", async () => {
    const app = express();
    app.use(express.json());
    app.post(
      "/demo",
      validate([body("name").isString().notEmpty()]),
      (req, res) => res.status(200).json({ ok: true })
    );

    const res = await request(app).post("/demo").send({ name: "" }).expect(422);
    expect(res.body).toHaveProperty("message", "Validation failed");
    expect(res.body).toHaveProperty("error.code", "VALIDATION_FAILED");
    expect(res.body).toHaveProperty("error.details.errors");
    expect(Array.isArray(res.body.error.details.errors)).toBe(true);
  });
});
