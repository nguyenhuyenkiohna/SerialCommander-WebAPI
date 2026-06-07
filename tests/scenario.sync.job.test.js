process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("modules/config/services/scenarioSyncJobService", () => ({
  processPendingJobs: jest.fn(),
}));

jest.mock("kernels/logging/appLogger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

const { processPendingJobs } = require("modules/config/services/scenarioSyncJobService");
const appMetrics = require("kernels/metrics/appMetrics");
const appLogger = require("kernels/logging/appLogger");
const { runOnce, startScenarioSyncJob } = require("kernels/jobs/scenarioSyncJob");

describe("scenarioSyncJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(appMetrics, "inc").mockImplementation(() => {});
    jest.spyOn(appMetrics, "recordLatency").mockImplementation(() => {});
    delete process.env.SYNC_JOB_BATCH_BUDGET_MS;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("runOnce logs summary when jobs processed", async () => {
    processPendingJobs.mockResolvedValue({ scanned: 3, succeeded: 2, failed: 1 });
    await runOnce();
    expect(appLogger.logInfo).toHaveBeenCalled();
    expect(appMetrics.inc).toHaveBeenCalledWith("scenario_sync_batches_total");
    expect(appMetrics.inc).toHaveBeenCalledWith("sync_jobs_batch_runs_with_job_failures_total");
    expect(appMetrics.recordLatency).toHaveBeenCalledWith(
      "sync_jobs_batch_process",
      expect.any(Number)
    );
  });

  test("runOnce tăng scenario_sync_executor_errors_total khi processPendingJobs throw", async () => {
    processPendingJobs.mockRejectedValue(new Error("worker boom"));
    await runOnce();
    expect(appLogger.logWarn).toHaveBeenCalled();
    expect(appMetrics.inc).toHaveBeenCalledWith("scenario_sync_executor_errors_total");
  });

  test("runOnce đếm sync_jobs_batch_budget_violations_total khi vượt budget", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      process.env.SYNC_JOB_BATCH_BUDGET_MS = "5";
      processPendingJobs.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ scanned: 1, succeeded: 1, failed: 0 }), 50);
          })
      );
      const p = runOnce();
      await jest.advanceTimersByTimeAsync(60);
      await p;

      expect(appMetrics.inc).toHaveBeenCalledWith("sync_jobs_batch_budget_violations_total");
    } finally {
      jest.useRealTimers();
    }
  });

  test("startScenarioSyncJob skips in test", () => {
    startScenarioSyncJob();
    expect(processPendingJobs).not.toHaveBeenCalled();
  });
});
