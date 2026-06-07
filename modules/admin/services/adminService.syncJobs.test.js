process.env.NODE_ENV = "test";

require("rootpath")();

const { QueryTypes } = require("sequelize");

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

describe("adminService.getSyncJobsOpsSummary", () => {
  beforeEach(() => {
    SyncJob.sequelize.query.mockReset();
  });

  test("gộp by_status, due_for_processing và failed_recent", async () => {
    SyncJob.sequelize.query
      .mockResolvedValueOnce([
        { status: "failed", cnt: 1 },
        { status: "pending", cnt: 4 },
      ])
      .mockResolvedValueOnce([{ cnt: 5 }])
      .mockResolvedValueOnce([
        {
          Id: 99n,
          OperationType: "upsert",
          ScenarioId: "s1",
          RetryCount: 3,
          LastError: "timeout",
          ModifiedAt: new Date("2026-05-09T10:00:00.000Z"),
        },
      ]);

    const summary = await adminService.getSyncJobsOpsSummary();

    expect(summary.by_status).toEqual({ failed: 1, pending: 4 });
    expect(summary.due_for_processing).toBe(5);
    expect(summary.failed_recent).toHaveLength(1);
    expect(summary.failed_recent[0]).toMatchObject({
      id: "99",
      operation_type: "upsert",
      scenario_id: "s1",
      retry_count: 3,
      last_error: "timeout",
    });
    expect(SyncJob.sequelize.query).toHaveBeenCalledTimes(3);
    expect(SyncJob.sequelize.query.mock.calls[0][1]).toEqual({ type: QueryTypes.SELECT });
  });
});
