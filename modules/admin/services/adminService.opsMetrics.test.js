process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("kernels/metrics/appMetrics", () => ({
  getCountersSnapshot: jest.fn(() => ({ http_rate_limit_429_total: 2 })),
  getLatencyGaugeSnapshot: jest.fn(() => ({})),
}));

jest.mock("models", () => ({
  Scenario: {},
  SyncJob: {
    sequelize: {
      query: jest.fn(),
    },
  },
}));

const { SyncJob } = require("models");
const adminService = require("./adminService");
const { QueryTypes } = require("sequelize");

describe("adminService.getOpsAppMetrics", () => {
  beforeEach(() => {
    SyncJob.sequelize.query.mockReset();
  });

  test("ghép counters và gauges SyncJobs", async () => {
    SyncJob.sequelize.query
      .mockResolvedValueOnce([
        { status: "pending", cnt: 3 },
        { status: "failed", cnt: 1 },
      ])
      .mockResolvedValueOnce([{ cnt: 4 }]);

    const payload = await adminService.getOpsAppMetrics();
    expect(payload.counters.http_rate_limit_429_total).toBe(2);
    expect(payload.gauges.sync_jobs_pending).toBe(3);
    expect(payload.gauges.sync_jobs_failed).toBe(1);
    expect(payload.gauges.sync_jobs_due_for_processing).toBe(4);
    expect(SyncJob.sequelize.query).toHaveBeenCalledTimes(2);
    expect(SyncJob.sequelize.query.mock.calls[0][1]).toEqual({ type: QueryTypes.SELECT });
  });
});
