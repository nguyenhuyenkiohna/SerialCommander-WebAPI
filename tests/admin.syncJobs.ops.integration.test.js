process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-admin-sync";
process.env.SESSION_SECRET = "test-session-secret-admin-sync-ok";
process.env.FRONTEND_URL = "http://localhost:5173";

require("rootpath")();

jest.mock("configs/passport", () => ({
  initialize: () => (_req, _res, next) => next(),
  session: () => (_req, _res, next) => next(),
  authenticate: () => (_req, _res, next) => next(),
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
const adminService = require("modules/admin/services/adminService");
const app = require("index");

describe("Admin SyncJobs ops API", () => {
  const adminToken = jwt.sign(
    { id: 1, username: "admin1", role: "admin" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("GET /admin/ops/sync-jobs trả summary + trace_id đồng bộ header", async () => {
    jest.spyOn(adminService, "getSyncJobsOpsSummary").mockResolvedValue({
      generated_at: "2026-05-09T12:00:00.000Z",
      by_status: { pending: 2, failed: 1 },
      due_for_processing: 3,
      failed_recent: [],
    });

    const res = await request(app)
      .get("/admin/ops/sync-jobs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.message).toBeTruthy();
    expect(res.body.summary.due_for_processing).toBe(3);
    expect(res.body.trace_id).toBeTruthy();
    expect(res.headers["x-request-id"]).toBe(res.body.trace_id);
  });

  test("403 khi user thường", async () => {
    const userToken = jwt.sign({ id: 2, role: "user" }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    await request(app)
      .get("/admin/ops/sync-jobs")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(403);
  });

  test("GET /admin/ops/metrics JSON envelope", async () => {
    jest.spyOn(adminService, "getOpsAppMetrics").mockResolvedValue({
      generated_at: "2026-05-09T14:00:00.000Z",
      counters: { http_rate_limit_429_total: 1 },
      gauges: { sync_jobs_pending: 2, sync_jobs_due_for_processing: 2 },
    });

    const res = await request(app)
      .get("/admin/ops/metrics")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.metrics.gauges.sync_jobs_pending).toBe(2);
    expect(res.body.metrics.counters.http_rate_limit_429_total).toBe(1);
  });

  test("GET /admin/ops/metrics?format=prometheus trả text", async () => {
    jest.spyOn(adminService, "getOpsAppMetrics").mockResolvedValue({
      generated_at: "2026-05-09T14:00:00.000Z",
      counters: { http_rate_limit_429_total: 5 },
      gauges: { sync_jobs_pending: 1 },
    });

    const res = await request(app)
      .get("/admin/ops/metrics?format=prometheus")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(String(res.headers["content-type"])).toMatch(/text\/plain/);
    expect(res.text).toContain("http_rate_limit_429_total");
    expect(res.text).toContain("sync_jobs_pending");
  });
});
