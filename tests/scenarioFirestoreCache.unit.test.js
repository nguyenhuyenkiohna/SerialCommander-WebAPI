/**
 * Unit tests: Redis cache layer trong scenarioFirestoreService
 *
 * Kiểm tra:
 *  - Cache hit: Firestore không được gọi nếu Redis có data
 *  - Cache miss: Firestore được gọi, kết quả được lưu vào Redis
 *  - Cache null: "không có document" cũng được cache (tránh stampede)
 *  - Invalidate on write: batchSaveScenarioContent xóa cache tương ứng
 *  - Invalidate on delete: batchDeleteScenarioContent xóa cache
 *  - batchGetScenarioContentArrays: chỉ gọi Firestore cho ids không có trong cache
 */
process.env.NODE_ENV = "test";

const cacheStore = new Map();

const mockRedisClient = {
  status: "ready",
  connect: jest.fn(),
  get: jest.fn().mockImplementation((key) => Promise.resolve(cacheStore.get(key) ?? null)),
  set: jest.fn().mockImplementation((key, value) => {
    cacheStore.set(key, value);
    return Promise.resolve("OK");
  }),
  del: jest.fn().mockImplementation((...keys) => {
    for (const k of keys) cacheStore.delete(k);
    return Promise.resolve(keys.length);
  }),
};

jest.mock("../kernels/redis/redisClients", () => ({
  getOutboxClient: jest.fn().mockReturnValue(mockRedisClient),
}));

jest.mock("../kernels/logging/appLogger", () => ({
  logWarn: jest.fn(),
  logInfo: jest.fn(),
}));

const MOCK_CONTENT = [{ type: "button", label: "ON" }];
const MOCK_SNAP_DATA = { content: MOCK_CONTENT };

const mockFirestoreDoc = jest.fn();
const mockFirestoreGetAll = jest.fn();

const mockDb = {
  collection: jest.fn().mockReturnThis(),
  doc: jest.fn().mockImplementation((id) => {
    mockFirestoreDoc(id);
    return { id };
  }),
  batch: jest.fn().mockReturnValue({
    set: jest.fn(),
    delete: jest.fn(),
    commit: jest.fn().mockResolvedValue(),
  }),
  getAll: jest.fn(),
};

jest.mock("../kernels/firebaseAdmin", () => ({
  getFirestore: jest.fn().mockReturnValue(mockDb),
  getAdmin: jest.fn().mockReturnValue({
    firestore: { FieldValue: { serverTimestamp: jest.fn().mockReturnValue("TS") } },
  }),
  isFirebaseReady: jest.fn().mockReturnValue(true),
}));

jest.mock("./scenarioFirestoreService.firebaseStorage", () => ({
  saveScenarioJsonSnapshot: jest.fn().mockResolvedValue(),
  deleteScenarioJsonSnapshot: jest.fn().mockResolvedValue(),
}), { virtual: true });

jest.mock("../modules/config/services/firebaseStorageService", () => ({
  saveScenarioJsonSnapshot: jest.fn().mockResolvedValue(),
  deleteScenarioJsonSnapshot: jest.fn().mockResolvedValue(),
}));

const CACHE_PREFIX = "scenario:content:cache:";
const firestoreService = require("../modules/config/services/scenarioFirestoreService");

beforeEach(() => {
  cacheStore.clear();
  jest.clearAllMocks();
  mockRedisClient.get.mockImplementation((key) => Promise.resolve(cacheStore.get(key) ?? null));
  mockRedisClient.set.mockImplementation((key, value) => {
    cacheStore.set(key, value);
    return Promise.resolve("OK");
  });
  mockRedisClient.del.mockImplementation((...keys) => {
    for (const k of keys) cacheStore.delete(k);
    return Promise.resolve(keys.length);
  });
  mockDb.getAll.mockImplementation((...refs) =>
    Promise.resolve(
      refs.map((ref) => ({
        id: ref.id,
        exists: true,
        data: () => MOCK_SNAP_DATA,
      }))
    )
  );
});

describe("scenarioFirestoreService — getScenarioContentArray cache", () => {
  test("cache miss → gọi Firestore, populate cache", async () => {
    const snap = {
      exists: true,
      data: () => MOCK_SNAP_DATA,
    };
    mockDb.collection.mockReturnValueOnce({
      doc: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue(snap) }),
    });

    const result = await firestoreService.getScenarioContentArray("id-001");
    expect(result).toEqual(MOCK_CONTENT);
    // Cache phải được set
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      `${CACHE_PREFIX}id-001`,
      JSON.stringify(MOCK_CONTENT),
      "EX",
      expect.any(Number)
    );
  });

  test("cache hit → không gọi Firestore", async () => {
    cacheStore.set(`${CACHE_PREFIX}id-cached`, JSON.stringify(MOCK_CONTENT));

    const result = await firestoreService.getScenarioContentArray("id-cached");
    expect(result).toEqual(MOCK_CONTENT);
    // db.collection không được gọi khi cache hit
    expect(mockDb.collection).not.toHaveBeenCalled();
  });

  test("cache null (không có document) → cache hit với null, không gọi Firestore", async () => {
    // Cache null có nghĩa là document không tồn tại — được lưu để tránh stampede
    cacheStore.set(`${CACHE_PREFIX}id-null`, JSON.stringify(null));
    const result = await firestoreService.getScenarioContentArray("id-null");
    expect(result).toBeNull();
    expect(mockDb.collection).not.toHaveBeenCalled();
  });
});

describe("scenarioFirestoreService — batchGetScenarioContentArrays cache", () => {
  test("tất cả ids có cache → Firestore getAll không được gọi", async () => {
    cacheStore.set(`${CACHE_PREFIX}a1`, JSON.stringify([{ type: "knob" }]));
    cacheStore.set(`${CACHE_PREFIX}b2`, JSON.stringify([{ type: "slider" }]));

    const map = await firestoreService.batchGetScenarioContentArrays(["a1", "b2"]);
    expect(map.get("a1")).toEqual([{ type: "knob" }]);
    expect(map.get("b2")).toEqual([{ type: "slider" }]);
    expect(mockDb.getAll).not.toHaveBeenCalled();
  });

  test("partial cache miss → getAll chỉ nhận ids bị miss", async () => {
    cacheStore.set(`${CACHE_PREFIX}cached-id`, JSON.stringify(MOCK_CONTENT));

    const map = await firestoreService.batchGetScenarioContentArrays(["cached-id", "miss-id"]);
    expect(map.get("cached-id")).toEqual(MOCK_CONTENT);
    expect(map.has("miss-id")).toBe(true);

    // getAll phải chỉ gọi với ["miss-id"], không phải "cached-id"
    expect(mockDb.getAll).toHaveBeenCalledTimes(1);
    const args = mockDb.getAll.mock.calls[0];
    expect(args.every((ref) => ref.id !== "cached-id")).toBe(true);
    expect(args.some((ref) => ref.id === "miss-id")).toBe(true);
  });

  test("cache miss → kết quả được lưu vào Redis sau khi đọc Firestore", async () => {
    await firestoreService.batchGetScenarioContentArrays(["new-id"]);
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      `${CACHE_PREFIX}new-id`,
      expect.any(String),
      "EX",
      expect.any(Number)
    );
  });
});

describe("scenarioFirestoreService — cache invalidation", () => {
  test("batchSaveScenarioContent xóa cache của ids được write", async () => {
    cacheStore.set(`${CACHE_PREFIX}w1`, JSON.stringify(MOCK_CONTENT));
    cacheStore.set(`${CACHE_PREFIX}w2`, JSON.stringify(MOCK_CONTENT));

    await firestoreService.batchSaveScenarioContent([
      { scenarioId: "w1", content: [] },
      { scenarioId: "w2", content: [] },
    ]);

    expect(mockRedisClient.del).toHaveBeenCalledWith(
      `${CACHE_PREFIX}w1`,
      `${CACHE_PREFIX}w2`
    );
  });

  test("batchDeleteScenarioContent xóa cache tương ứng", async () => {
    cacheStore.set(`${CACHE_PREFIX}d1`, JSON.stringify(MOCK_CONTENT));

    await firestoreService.batchDeleteScenarioContent(["d1"]);

    expect(mockRedisClient.del).toHaveBeenCalledWith(`${CACHE_PREFIX}d1`);
    expect(cacheStore.has(`${CACHE_PREFIX}d1`)).toBe(false);
  });
});
