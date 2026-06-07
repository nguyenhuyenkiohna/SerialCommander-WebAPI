process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("modules/auth/services/authDomainService", () => ({
  cleanupExpiredAuthCodes: jest.fn(),
}));

jest.mock("kernels/logging/appLogger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

const { cleanupExpiredAuthCodes } = require("modules/auth/services/authDomainService");
const appLogger = require("kernels/logging/appLogger");
const { runOnce, startAuthCodeCleanupJob } = require("kernels/jobs/authCodeCleanupJob");

describe("authCodeCleanupJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("runOnce logs when deleted rows exist", async () => {
    cleanupExpiredAuthCodes.mockResolvedValue({
      deletedExpiredVerification: 1,
      deletedExpiredReset: 0,
      deletedUsedVerification: 2,
      deletedUsedReset: 0,
      retentionDays: 7,
    });

    await runOnce();

    expect(appLogger.logInfo).toHaveBeenCalled();
  });

  test("runOnce warns on service errors", async () => {
    cleanupExpiredAuthCodes.mockRejectedValue(new Error("db down"));

    await runOnce();

    expect(appLogger.logWarn).toHaveBeenCalled();
  });

  test("startAuthCodeCleanupJob skips in test environment", async () => {
    cleanupExpiredAuthCodes.mockResolvedValue({
      deletedExpiredVerification: 1,
      deletedExpiredReset: 1,
      deletedUsedVerification: 0,
      deletedUsedReset: 0,
      retentionDays: 7,
    });

    startAuthCodeCleanupJob();

    expect(cleanupExpiredAuthCodes).not.toHaveBeenCalled();
  });
});
