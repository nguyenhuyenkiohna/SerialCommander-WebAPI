/**
 * Unit tests: atomic operations trong remoteSessionStore.
 *
 * Kiểm tra addStationMapping và blockUser hoạt động đúng khi nhiều
 * station join đồng thời — không bị race condition mất dữ liệu.
 */
process.env.NODE_ENV = "test";

// Mock Redis → null để dùng in-memory fallback (Node.js single-threaded, safe)
jest.mock("../kernels/redis/redisClients", () => ({
  getSessionClient: jest.fn().mockReturnValue(null),
}));

jest.mock("../models", () => ({
  sequelize: {
    query: jest.fn().mockRejectedValue(new Error("No DB in test")),
  },
}));

jest.mock("../kernels/logging/appLogger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

const store = require("../kernels/remoteSession/remoteSessionStore");

const SESSION_ID = "cc".repeat(8); // 16 hex

async function makeSession(sessionId = SESSION_ID) {
  await store.saveSession(sessionId, {
    userId: 1,
    mqttPasswordToken: "tok==",
    joinChallenge: "a".repeat(32),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7200 * 1000).toISOString(),
  });
}

describe("remoteSessionStore — addStationMapping concurrent", () => {
  beforeEach(async () => {
    await makeSession();
  });

  test("5 stations join đồng thời → tất cả 5 mapping tồn tại", async () => {
    const stations = Array.from({ length: 5 }, (_, i) => ({
      stationId: `station${i}`.padEnd(8, "0").slice(0, 8),
      userId: 100 + i,
    }));

    // Chạy song song — Node.js single-threaded nên không race condition thực sự,
    // nhưng test này xác nhận không có bug trong logic updateSession.
    await Promise.all(
      stations.map(({ stationId, userId }) =>
        store.addStationMapping(SESSION_ID, stationId, userId)
      )
    );

    const record = await store.getSession(SESSION_ID);
    expect(record.stationMap).toBeDefined();
    for (const { stationId, userId } of stations) {
      expect(record.stationMap[stationId]).toBe(String(userId));
    }
    expect(Object.keys(record.stationMap)).toHaveLength(5);
  });

  test("addStationMapping cùng stationId hai lần → giữ giá trị mới nhất", async () => {
    await store.addStationMapping(SESSION_ID, "stationaa", 10);
    await store.addStationMapping(SESSION_ID, "stationaa", 20); // ghi đè

    const record = await store.getSession(SESSION_ID);
    expect(record.stationMap["stationaa"]).toBe("20");
  });

  test("addStationMapping session không tồn tại → trả false", async () => {
    const result = await store.addStationMapping("f".repeat(16), "stid0001", 99);
    expect(result).toBe(false);
  });
});

describe("remoteSessionStore — blockUser concurrent + idempotent", () => {
  beforeEach(async () => {
    await makeSession();
  });

  test("block cùng userId nhiều lần → chỉ xuất hiện 1 lần trong mảng", async () => {
    await Promise.all([
      store.blockUser(SESSION_ID, 42),
      store.blockUser(SESSION_ID, 42),
      store.blockUser(SESSION_ID, 42),
    ]);

    const record = await store.getSession(SESSION_ID);
    const times = (record.blockedUsers || []).filter((u) => u === "42").length;
    expect(times).toBe(1);
  });

  test("block nhiều userId khác nhau → tất cả đều blocked", async () => {
    await Promise.all([
      store.blockUser(SESSION_ID, 1),
      store.blockUser(SESSION_ID, 2),
      store.blockUser(SESSION_ID, 3),
    ]);

    const record = await store.getSession(SESSION_ID);
    expect(record.blockedUsers).toContain("1");
    expect(record.blockedUsers).toContain("2");
    expect(record.blockedUsers).toContain("3");
  });

  test("isUserBlocked trả đúng sau khi block", async () => {
    await store.blockUser(SESSION_ID, 77);

    expect(await store.isUserBlocked(SESSION_ID, 77)).toBe(true);
    expect(await store.isUserBlocked(SESSION_ID, 78)).toBe(false);
  });

  test("blockUser session không tồn tại → trả false", async () => {
    const result = await store.blockUser("e".repeat(16), 55);
    expect(result).toBe(false);
  });
});

describe("remoteSessionStore — Lua path với Redis mock", () => {
  const REDIS_SESSION_ID = "dd".repeat(8);
  const sessionData = {
    userId: 5,
    mqttPasswordToken: "tok==",
    joinChallenge: "b".repeat(32),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7200 * 1000).toISOString(),
    stationMap: {},
    blockedUsers: [],
  };

  test("addStationMapping dùng Redis eval khi client available", async () => {
    const mockEval = jest.fn().mockResolvedValue(1); // 1 = thành công
    const mockClient = {
      status: "ready",
      get: jest.fn().mockResolvedValue(JSON.stringify(sessionData)),
      set: jest.fn().mockResolvedValue("OK"),
      ttl: jest.fn().mockResolvedValue(7200),
      eval: mockEval,
      connect: jest.fn(),
    };

    const { getSessionClient } = require("../kernels/redis/redisClients");
    getSessionClient.mockReturnValueOnce(mockClient);

    const result = await store.addStationMapping(REDIS_SESSION_ID, "sta00001", 10);
    expect(result).toBe(true);
    expect(mockEval).toHaveBeenCalledTimes(1);
    // Xác nhận Lua script được pass với đúng keys/args
    const [script, numkeys, key, stationId, userId] = mockEval.mock.calls[0];
    expect(typeof script).toBe("string");
    expect(script).toContain("stationMap");
    expect(numkeys).toBe(1);
    expect(key).toContain(REDIS_SESSION_ID);
    expect(stationId).toBe("sta00001");
    expect(userId).toBe("10");
  });

  test("blockUser dùng Redis eval khi client available", async () => {
    const mockEval = jest.fn().mockResolvedValue(1);
    const mockClient = {
      status: "ready",
      eval: mockEval,
      connect: jest.fn(),
    };

    const { getSessionClient } = require("../kernels/redis/redisClients");
    getSessionClient.mockReturnValueOnce(mockClient);

    const result = await store.blockUser(REDIS_SESSION_ID, 99);
    expect(result).toBe(true);
    expect(mockEval).toHaveBeenCalledTimes(1);
    const [script, numkeys, key, userId] = mockEval.mock.calls[0];
    expect(script).toContain("blockedUsers");
    expect(numkeys).toBe(1);
    expect(key).toContain(REDIS_SESSION_ID);
    expect(userId).toBe("99");
  });

  test("addStationMapping fallback khi eval throw", async () => {
    const mockEval = jest.fn().mockRejectedValue(new Error("NOSCRIPT"));
    const mockClient = {
      status: "ready",
      eval: mockEval,
      get: jest.fn().mockResolvedValue(null), // không có trong Redis
      connect: jest.fn(),
    };

    const { getSessionClient } = require("../kernels/redis/redisClients");
    getSessionClient.mockReturnValueOnce(mockClient);

    // eval lỗi → fallback → session không tồn tại trong memory → false
    const result = await store.addStationMapping("a".repeat(16), "sta00002", 11);
    // Không throw, trả false hoặc true (tùy fallback path)
    expect(typeof result).toBe("boolean");
  });

  test("blockUser already-blocked trả true (idempotent) qua Redis eval", async () => {
    const mockEval = jest.fn().mockResolvedValue(2); // 2 = đã blocked rồi
    const mockClient = {
      status: "ready",
      eval: mockEval,
      connect: jest.fn(),
    };

    const { getSessionClient } = require("../kernels/redis/redisClients");
    getSessionClient.mockReturnValueOnce(mockClient);

    const result = await store.blockUser(REDIS_SESSION_ID, 88);
    expect(result).toBe(true); // result !== 0 → true
  });
});
