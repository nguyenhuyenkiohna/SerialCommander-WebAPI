/**
 * Unit tests: updateSession CAS (Compare-And-Swap) trong remoteSessionStore.
 *
 * Kiểm tra:
 *  - CAS Lua script được gọi đúng khi Redis client available
 *  - Retry khi eval trả -1 (concurrent modification)
 *  - Trả false khi key không tồn tại (eval trả 0)
 *  - Fallback in-memory khi Redis null
 */
process.env.NODE_ENV = "test";

jest.mock("../kernels/redis/redisClients", () => ({
  getSessionClient: jest.fn().mockReturnValue(null),
}));

jest.mock("../models", () => ({
  sequelize: { query: jest.fn().mockRejectedValue(new Error("No DB in test")) },
}));

jest.mock("../kernels/logging/appLogger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

const store = require("../kernels/remoteSession/remoteSessionStore");
const { getSessionClient } = require("../kernels/redis/redisClients");

const SESSION_ID = "ab".repeat(8); // 16 hex
const initialPayload = {
  userId: 1,
  mqttPasswordToken: "tok==",
  joinChallenge: "c".repeat(32),
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 7200 * 1000).toISOString(),
};

function makeMockClient(evalResults, raw = JSON.stringify(initialPayload)) {
  let evalCallCount = 0;
  return {
    status: "ready",
    connect: jest.fn(),
    get: jest.fn().mockResolvedValue(raw),
    ttl: jest.fn().mockResolvedValue(3600),
    set: jest.fn().mockResolvedValue("OK"),
    eval: jest.fn().mockImplementation(() => {
      const result = Array.isArray(evalResults)
        ? evalResults[evalCallCount++] ?? evalResults[evalResults.length - 1]
        : evalResults;
      return Promise.resolve(result);
    }),
  };
}

describe("remoteSessionStore — updateSession CAS (Redis path)", () => {
  afterEach(() => {
    getSessionClient.mockReturnValue(null); // reset về in-memory fallback
  });

  test("CAS thành công lần đầu → eval được gọi với Lua CAS script", async () => {
    const mockClient = makeMockClient(1); // 1 = swap thành công
    getSessionClient.mockReturnValue(mockClient);

    const result = await store.updateSession(SESSION_ID, (data) => ({
      ...data,
      extra: "test",
    }));

    expect(result).toBe(true);
    expect(mockClient.eval).toHaveBeenCalledTimes(1);
    const [script, numkeys, key, _expectedRaw, newRaw] = mockClient.eval.mock.calls[0];
    expect(typeof script).toBe("string");
    expect(script).toContain("current ~= ARGV[1]"); // CAS check
    expect(numkeys).toBe(1);
    expect(key).toContain(SESSION_ID);
    const newData = JSON.parse(newRaw);
    expect(newData.extra).toBe("test");
    expect(newData.userId).toBe(1); // dữ liệu gốc được giữ
  });

  test("CAS retry khi eval trả -1 (concurrent modification), thành công ở lần 2", async () => {
    // -1 → giá trị thay đổi → retry; 1 → thành công
    const mockClient = makeMockClient([-1, 1]);
    getSessionClient.mockReturnValue(mockClient);

    const result = await store.updateSession(SESSION_ID, (data) => ({ ...data, flag: true }));

    expect(result).toBe(true);
    expect(mockClient.eval).toHaveBeenCalledTimes(2);
    expect(mockClient.get).toHaveBeenCalledTimes(2); // re-read mỗi lần retry
  });

  test("CAS trả false khi eval trả 0 (key không tồn tại)", async () => {
    const mockClient = makeMockClient(0);
    getSessionClient.mockReturnValue(mockClient);

    const result = await store.updateSession(SESSION_ID, (data) => data);
    expect(result).toBe(false);
  });

  test("CAS trả false sau khi hết tất cả retries (-1 mãi)", async () => {
    const mockClient = makeMockClient([-1, -1, -1]);
    getSessionClient.mockReturnValue(mockClient);

    const result = await store.updateSession(SESSION_ID, (data) => data);
    expect(result).toBe(false);
    expect(mockClient.eval).toHaveBeenCalledTimes(3); // CAS_MAX_RETRIES = 3
  });

  test("CAS trả false khi GET trả null (key không tồn tại trước eval)", async () => {
    const mockClient = makeMockClient(1, null); // get → null
    getSessionClient.mockReturnValue(mockClient);

    const result = await store.updateSession(SESSION_ID, (data) => data);
    expect(result).toBe(false);
    expect(mockClient.eval).not.toHaveBeenCalled(); // không gọi eval nếu GET trả null
  });

  test("CAS trả false và log warn khi eval throw", async () => {
    const mockClient = {
      status: "ready",
      connect: jest.fn(),
      get: jest.fn().mockResolvedValue(JSON.stringify(initialPayload)),
      ttl: jest.fn().mockResolvedValue(3600),
      eval: jest.fn().mockRejectedValue(new Error("NOSCRIPT")),
    };
    getSessionClient.mockReturnValue(mockClient);

    const result = await store.updateSession(SESSION_ID, (data) => data);
    expect(result).toBe(false);
    const { logWarn } = require("../kernels/logging/appLogger");
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining("CAS updateSession failed"),
      expect.any(Object)
    );
  });
});

describe("remoteSessionStore — updateSession in-memory fallback (Redis null)", () => {
  const MEM_SESSION_ID = "ef".repeat(8);

  beforeEach(async () => {
    getSessionClient.mockReturnValue(null);
    await store.saveSession(MEM_SESSION_ID, { ...initialPayload });
  });

  test("cập nhật field trong in-memory session", async () => {
    const result = await store.updateSession(MEM_SESSION_ID, (data) => ({
      ...data,
      customField: "hello",
    }));
    expect(result).toBe(true);

    const record = await store.getSession(MEM_SESSION_ID);
    expect(record.customField).toBe("hello");
    expect(record.userId).toBe(1); // dữ liệu gốc giữ nguyên
  });

  test("trả false nếu session không tồn tại trong memory", async () => {
    const result = await store.updateSession("0".repeat(16), (data) => data);
    expect(result).toBe(false);
  });
});
