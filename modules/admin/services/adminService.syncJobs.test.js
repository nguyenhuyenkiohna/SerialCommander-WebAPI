process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("kernels/scenarioSyncQueue", () => ({
  getQueueLengths: jest.fn(),
  peekDlq: jest.fn(),
}));

jest.mock("kernels/scenarioDlqReconcile", () => ({
  reconcileDlqBatch: jest.fn(),
}));

jest.mock("models", () => ({
  Scenario: {},
}));

const scenarioSyncQueue = require("kernels/scenarioSyncQueue");
const adminService = require("./adminService");

describe("adminService.getSyncJobsOpsSummary (redis outbox)", () => {
  beforeEach(() => {
    scenarioSyncQueue.getQueueLengths.mockReset();
    scenarioSyncQueue.peekDlq.mockReset();
  });

  test("gộp queue lengths và DLQ peek vào summary", async () => {
    scenarioSyncQueue.getQueueLengths.mockResolvedValue({
      queue: 4,
      processing: 1,
      dlq: 2,
    });
    scenarioSyncQueue.peekDlq.mockResolvedValue([
      {
        raw: '{"scenarioId":"s1","action":"SYNC_FIRESTORE","retryCount":5}',
        parsed: {
          scenarioId: "s1",
          action: "SYNC_FIRESTORE",
          retryCount: 5,
          enqueuedAt: "2026-06-10T00:00:00.000Z",
        },
      },
    ]);

    const summary = await adminService.getSyncJobsOpsSummary();

    expect(summary.source).toBe("redis_outbox");
    expect(summary.by_status).toEqual({ pending: 4, processing: 1, failed: 2 });
    expect(summary.due_for_processing).toBe(4);
    expect(summary.failed_recent).toHaveLength(1);
    expect(summary.failed_recent[0]).toMatchObject({
      operation_type: "SYNC_FIRESTORE",
      scenario_id: "s1",
      retry_count: 5,
    });
  });
});
