process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("kernels/logging/appLogger", () => ({
  logWarn: jest.fn(),
}));

function makeRedisMock({ setResult = "OK", getReturns = null } = {}) {
  const calls = { set: [], get: [], del: [] };
  return {
    calls,
    client: {
      set: jest.fn(async (...args) => {
        calls.set.push(args);
        return setResult;
      }),
      get: jest.fn(async (key) => {
        calls.get.push(key);
        return getReturns;
      }),
      del: jest.fn(async (key) => {
        calls.del.push(key);
        return 1;
      }),
    },
  };
}

describe("redisJobLease", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "test";
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("không Redis, không strict: chạy worker", async () => {
    const { runScheduledWorkWithLease } = require("kernels/jobs/redisJobLease");
    const worker = jest.fn(async () => {});

    const out = await runScheduledWorkWithLease(
      { getRedis: () => null, lockKey: "k", lockTtlMs: 1000, logLabel: "t" },
      worker
    );

    expect(out.ran).toBe(true);
    expect(worker).toHaveBeenCalled();
  });

  test("production + strict + không Redis: không chạy worker", async () => {
    process.env.NODE_ENV = "production";
    process.env.SCHEDULER_STRICT_REPLICA_MODE = "true";
    const { runScheduledWorkWithLease } = require("kernels/jobs/redisJobLease");
    const { logWarn: logWarnFromModule } = require("kernels/logging/appLogger");
    const worker = jest.fn(async () => {});

    const out = await runScheduledWorkWithLease(
      { getRedis: () => null, lockKey: "k", lockTtlMs: 1000, logLabel: "t" },
      worker
    );

    expect(out.ran).toBe(false);
    expect(out.skippedNoRedis).toBe(true);
    expect(worker).not.toHaveBeenCalled();
    expect(logWarnFromModule).toHaveBeenCalled();
  });

  test("SET NX thất bại: không chạy worker", async () => {
    const { client } = makeRedisMock({ setResult: null });
    const { runScheduledWorkWithLease } = require("kernels/jobs/redisJobLease");
    const worker = jest.fn(async () => {});

    const out = await runScheduledWorkWithLease(
      { getRedis: () => client, lockKey: "lock:x", lockTtlMs: 5000, logLabel: "t" },
      worker
    );

    expect(out.ran).toBe(false);
    expect(out.skippedLock).toBe(true);
    expect(worker).not.toHaveBeenCalled();
  });

  test("giữ lock OK: chạy worker rồi del khi get khớp", async () => {
    const { client, calls } = makeRedisMock({ setResult: "OK" });
    client.get.mockImplementation(async () => {
      const v = calls.set.length ? calls.set[0][1] : null;
      return v;
    });

    const { runScheduledWorkWithLease } = require("kernels/jobs/redisJobLease");
    const worker = jest.fn(async () => {});

    const out = await runScheduledWorkWithLease(
      { getRedis: () => client, lockKey: "lock:y", lockTtlMs: 5000, logLabel: "t" },
      worker
    );

    expect(out.ran).toBe(true);
    expect(worker).toHaveBeenCalled();
    expect(client.set).toHaveBeenCalled();
    expect(client.del).toHaveBeenCalledWith("lock:y");
  });
});
