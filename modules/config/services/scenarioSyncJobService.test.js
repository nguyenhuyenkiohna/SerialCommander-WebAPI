process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("models", () => ({
  SyncJob: {
    create: jest.fn(),
    findAll: jest.fn(),
    sequelize: {
      query: jest.fn().mockResolvedValue([[], 0]),
      QueryTypes: { UPDATE: "UPDATE" },
    },
  },
}));

jest.mock("modules/config/services/scenarioFirestoreService", () => ({
  saveScenarioContent: jest.fn(),
  deleteScenarioContent: jest.fn(),
}));

const { Op, col, where } = require("sequelize");
const { SyncJob } = require("models");
const scenarioFirestore = require("modules/config/services/scenarioFirestoreService");
const { enqueue, processPendingJobs, buildPendingSyncJobsWhere } = require("./scenarioSyncJobService");

describe("scenarioSyncJobService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("enqueue ignores duplicate operation key", async () => {
    const err = new Error("dup");
    err.name = "SequelizeUniqueConstraintError";
    SyncJob.create.mockRejectedValue(err);

    await expect(
      enqueue("scenario_delete", "s1", null, "firestore failed")
    ).resolves.toBeUndefined();
  });

  test("buildPendingSyncJobsWhere kết hợp điều kiện trạng thái và NextRetryAt", () => {
    const t = new Date("2027-01-15T08:00:00.000Z");
    const w = buildPendingSyncJobsWhere(t);
    expect(w[Op.and]).toHaveLength(2);
    const statusSide = w[Op.and][0];
    expect(statusSide[Op.or]).toHaveLength(2);
    expect(statusSide[Op.or][0]).toEqual({ Status: "pending" });
    const failedBranch = statusSide[Op.or][1];
    expect(failedBranch[Op.and][0]).toEqual({ Status: "failed" });
    expect(failedBranch[Op.and][1]).toEqual(where(col("RetryCount"), Op.lt, col("MaxRetries")));
    const retrySide = w[Op.and][1];
    expect(retrySide[Op.or]).toEqual([{ NextRetryAt: null }, { NextRetryAt: { [Op.lte]: t } }]);
  });

  test("processPendingJobs marks success on upsert", async () => {
    const update = jest.fn().mockResolvedValue(true);
    SyncJob.findAll.mockResolvedValue([
      {
        OperationType: "scenario_upsert",
        ScenarioId: "s1",
        Payload: JSON.stringify({ content: [{ a: 1 }] }),
        Status: "pending",
        RetryCount: 0,
        MaxRetries: 10,
        update,
      },
    ]);
    scenarioFirestore.saveScenarioContent.mockResolvedValue(true);

    const result = await processPendingJobs();
    expect(result.succeeded).toBe(1);
    const findArg = SyncJob.findAll.mock.calls[0][0];
    expect(findArg.where).toEqual(
      expect.objectContaining({ Status: "processing", WorkerId: expect.any(String) })
    );
    expect(findArg.order).toEqual([["CreatedAt", "ASC"]]);
  });

  test("processPendingJobs Payload JSON sai → failed + LastError mô tả", async () => {
    const update = jest.fn().mockResolvedValue(true);
    SyncJob.findAll.mockResolvedValue([
      {
        OperationType: "scenario_upsert",
        ScenarioId: "s-bad-json",
        Payload: "{broken",
        Status: "pending",
        RetryCount: 0,
        MaxRetries: 10,
        update,
      },
    ]);

    const result = await processPendingJobs();
    expect(result.failed).toBe(1);
    expect(update.mock.calls.some((call) => String(call[0]?.LastError || "").includes("Payload SyncJob JSON"))).toBe(
      true
    );
  });
});
