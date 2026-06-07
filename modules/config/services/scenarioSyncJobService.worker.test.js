process.env.NODE_ENV = "test";

jest.mock("../../../models", () => ({
  SyncJob: {
    findAll: jest.fn(),
    sequelize: {
      query: jest.fn().mockResolvedValue([[], 0]),
      QueryTypes: { UPDATE: "UPDATE" },
    },
  },
}));

jest.mock("./scenarioFirestoreService", () => ({
  saveScenarioContent: jest.fn().mockResolvedValue({}),
  deleteScenarioContent: jest.fn().mockResolvedValue({}),
}));

const { processPendingJobs } = require("./scenarioSyncJobService");
const { SyncJob } = require("../../../models");

describe("scenarioSyncJobService — WorkerId claiming", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SyncJob.sequelize.query.mockResolvedValue([[], 0]);
  });

  it("claims jobs with provided workerId and fetches only those jobs", async () => {
    SyncJob.findAll.mockResolvedValue([]);
    const workerId = "test-worker-abc";

    await processPendingJobs(10, workerId);

    const queryCalls = SyncJob.sequelize.query.mock.calls;
    // Call [0] = stale recovery, call [1] = claim
    const claimCall = queryCalls[1];
    expect(claimCall[0]).toContain("WorkerId = :workerId");
    expect(claimCall[1].replacements.workerId).toBe(workerId);

    // Fetch must filter by WorkerId
    expect(SyncJob.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ WorkerId: workerId }),
      })
    );
  });

  it("runs stale recovery before claiming (resets stuck jobs)", async () => {
    SyncJob.findAll.mockResolvedValue([]);

    await processPendingJobs(10, "worker-1");

    const staleCall = SyncJob.sequelize.query.mock.calls[0];
    expect(staleCall[0]).toContain("Status = 'processing'");
    expect(staleCall[0]).toContain("WorkerId IS NOT NULL");
    expect(staleCall[0]).toContain("INTERVAL 30 MINUTE");
    expect(staleCall[0]).toContain("Status = 'pending'");
    expect(staleCall[0]).toContain("WorkerId = NULL");
  });

  it("two workers use different workerIds and fetch independent jobs", async () => {
    SyncJob.findAll.mockResolvedValue([]);

    await processPendingJobs(5, "worker-A");
    await processPendingJobs(5, "worker-B");

    const fetchCalls = SyncJob.findAll.mock.calls;
    expect(fetchCalls[0][0].where.WorkerId).toBe("worker-A");
    expect(fetchCalls[1][0].where.WorkerId).toBe("worker-B");
  });

  it("clears WorkerId after successful job execution", async () => {
    const mockJob = {
      id: 1,
      OperationType: "scenario_delete",
      ScenarioId: "sc-1",
      Payload: null,
      RetryCount: 0,
      update: jest.fn().mockResolvedValue({}),
    };
    SyncJob.findAll.mockResolvedValue([mockJob]);

    await processPendingJobs(10, "worker-cleanup");

    expect(mockJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ WorkerId: null, Status: "success" })
    );
  });

  it("clears WorkerId even on job failure", async () => {
    const mockJob = {
      id: 2,
      OperationType: "scenario_upsert",
      ScenarioId: "sc-fail",
      Payload: "invalid-json{{",
      RetryCount: 0,
      update: jest.fn().mockResolvedValue({}),
    };
    SyncJob.findAll.mockResolvedValue([mockJob]);

    await processPendingJobs(10, "worker-fail");

    expect(mockJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ WorkerId: null, Status: "failed" })
    );
  });

  it("auto-generates workerId if not provided", async () => {
    SyncJob.findAll.mockResolvedValue([]);

    const result = await processPendingJobs(10);

    expect(result.workerId).toBeDefined();
    expect(typeof result.workerId).toBe("string");
    expect(result.workerId.length).toBeGreaterThan(10);
  });
});
