/**
 * Integration tests — scenario routes (không cần MySQL cho verify/verify-file;
 * các route DB dùng spy trên scenarioService).
 */
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-for-jest-ok";

require("rootpath")();

const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const apiRouter = require("routes/api");
const scenarioService = require("modules/config/services/scenarioService");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/", apiRouter);
  return app;
}

const app = buildApp();

afterEach(() => {
  jest.restoreAllMocks();
});

const expectErrorContract = (res, code) => {
  expect(res.body).toHaveProperty("error");
  expect(res.body.error).toHaveProperty("code", code);
};

describe("Scenario API (integration)", () => {
  describe("POST /verify", () => {
    test("200 và có errors rỗng khi payload hợp lệ tối thiểu", async () => {
      const body = {
        Name: "Demo",
        Description: "OK",
        Content: JSON.stringify([{ Name: "b1", Type: "text" }]),
      };
      const res = await request(app).post("/verify").send(body).expect(200);
      expect(res.body.errors).toEqual([]);
    });

    test("200 và có errors khi thiếu Name", async () => {
      const res = await request(app)
        .post("/verify")
        .send({ Description: "x", Content: "[]" })
        .expect(200);
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(res.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe("POST /verify-file", () => {
    test("200 valid true với JSON kịch bản text/plain", async () => {
      const raw = JSON.stringify({
        Name: "F",
        Content: [{ Type: "text", Name: "A" }],
      });
      const res = await request(app)
        .post("/verify-file")
        .set("Content-Type", "text/plain")
        .send(raw)
        .expect(200);
      expect(res.body).toHaveProperty("valid", true);
      expect(res.body.errors).toHaveLength(0);
    });

    test("200 valid false khi JSON sai cú pháp", async () => {
      const res = await request(app)
        .post("/verify-file")
        .set("Content-Type", "text/plain")
        .send("{")
        .expect(200);
      expect(res.body.valid).toBe(false);
    });
  });

  describe("GET /share/:shareCode", () => {
    test("200 khi có kịch bản chia sẻ", async () => {
      jest.spyOn(scenarioService, "getScenarioByShareCode").mockResolvedValue({
        dataValues: {
          Name: "Shared",
          Description: "D",
          Content: "[]",
          Banner1: null,
          Banner2: null,
        },
      });
      const res = await request(app).get("/share/ABC123").expect(200);
      expect(typeof res.body.message).toBe("string");
      expect(res.body.Name).toBe("Shared");
      expect(res.body.Banners).toEqual([]);
    });

    test("404 khi service ném lỗi có statusCode 404", async () => {
      const err = Object.assign(new Error("not found"), { statusCode: 404 });
      jest.spyOn(scenarioService, "getScenarioByShareCode").mockRejectedValue(err);
      jest.spyOn(console, "error").mockImplementation(() => {});
      const res = await request(app).get("/share/none").expect(404);
      expectErrorContract(res, "SCENARIO_SHARE_FETCH_FAILED");
    });
  });

  describe("JWT /scenarios/*", () => {
    const token = jwt.sign(
      { id: 1, username: "u1", role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    const auth = { Authorization: `Bearer ${token}` };

    test("401 khi không gửi token", async () => {
      const res = await request(app).get("/scenarios/myscenarios").expect(401);
      expectErrorContract(res, "NO_TOKEN");
    });

    test("200 GET /scenarios/myscenarios khi có token (envelope scenarios)", async () => {
      jest.spyOn(scenarioService, "getScenariosByUserId").mockResolvedValue({
        scenarios: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
      const res = await request(app)
        .get("/scenarios/myscenarios")
        .set(auth)
        .expect(200);
      expect(Array.isArray(res.body.scenarios)).toBe(true);
      expect(res.body.scenarios).toHaveLength(0);
      expect(typeof res.body.message).toBe("string");
      expect(res.body.pagination).toMatchObject({ total: 0, hasMore: false });
    });

    test("200 GET /scenarios/myscenarios?legacy_array=1 trả mảng thuần", async () => {
      jest.spyOn(scenarioService, "getScenariosByUserId").mockResolvedValue({
        scenarios: [{ Id: "1", Name: "A" }],
        total: 1,
        limit: 50,
        offset: 0,
      });
      const res = await request(app)
        .get("/scenarios/myscenarios?legacy_array=1")
        .set(auth)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].Name).toBe("A");
    });

    test("200 GET /scenarios/:scenarioId", async () => {
      jest.spyOn(scenarioService, "getScenarioById").mockResolvedValue({
        Name: "Mine",
        Description: "",
        Content: "[]",
        Banner1: null,
        Banner2: null,
      });
      const res = await request(app)
        .get("/scenarios/5")
        .set(auth)
        .expect(200);
      expect(typeof res.body.message).toBe("string");
      expect(res.body.Name).toBe("Mine");
      expect(res.body.Banners).toEqual([]);
    });
  });
});
