process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("kernels/metrics/appMetrics", () => ({
  getCountersSnapshot: jest.fn(() => ({ http_rate_limit_429_total: 2 })),
  getLatencyGaugeSnapshot: jest.fn(() => ({})),
}));

jest.mock("kernels/scenarioSyncQueue", () => ({
  getQueueLengths: jest.fn(),
}));

jest.mock("models", () => ({
  Scenario: {},
}));

const scenarioSyncQueue = require("kernels/scenarioSyncQueue");
const adminService = require("./adminService");

describe("adminService.getOpsAppMetrics", () => {
  beforeEach(() => {
    scenarioSyncQueue.getQueueLengths.mockReset();
  });

  test("ghép counters và gauges outbox Redis", async () => {
    scenarioSyncQueue.getQueueLengths.mockResolvedValue({
      queue: 3,
      processing: 0,
      dlq: 1,
    });

    const payload = await adminService.getOpsAppMetrics();
    expect(payload.counters.http_rate_limit_429_total).toBe(2);
    expect(payload.gauges.sync_jobs_pending).toBe(3);
    expect(payload.gauges.sync_jobs_failed).toBe(1);
    expect(payload.gauges.sync_jobs_due_for_processing).toBe(3);
    expect(payload.gauges.scenario_outbox_dlq).toBe(1);
  });
});
