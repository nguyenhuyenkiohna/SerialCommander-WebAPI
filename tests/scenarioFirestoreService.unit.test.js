process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("kernels/firebaseAdmin", () => ({
  getFirestore: jest.fn(),
  getAdmin: jest.fn(),
  isFirebaseReady: jest.fn(),
}));

jest.mock("modules/config/services/firebaseStorageService", () => ({
  saveScenarioJsonSnapshot: jest.fn().mockResolvedValue(undefined),
  deleteScenarioJsonSnapshot: jest.fn().mockResolvedValue(undefined),
}));

const firebaseAdmin = require("kernels/firebaseAdmin");
const firebaseStorageService = require("modules/config/services/firebaseStorageService");
const scenarioFirestore = require("modules/config/services/scenarioFirestoreService");

function makeDocChain({ exists = true, data = {} } = {}) {
  const docRef = {
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue({ exists, data: () => data }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const batch = {
    set: jest.fn(),
    delete: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  };
  const db = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => docRef),
    })),
    batch: jest.fn(() => batch),
  };
  return { db, docRef, batch };
}

describe("scenarioFirestoreService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("saveScenarioContent ném 503 khi Firebase chưa sẵn sàng", async () => {
    firebaseAdmin.isFirebaseReady.mockReturnValue(false);

    await expect(
      scenarioFirestore.saveScenarioContent("sid-1", [{ Name: "a", Type: "t" }])
    ).rejects.toMatchObject({ statusCode: 503 });

    expect(firebaseStorageService.saveScenarioJsonSnapshot).not.toHaveBeenCalled();
  });

  test("saveScenarioContent ghi Firestore + snapshot Storage", async () => {
    firebaseAdmin.isFirebaseReady.mockReturnValue(true);
    const { db, batch } = makeDocChain();
    firebaseAdmin.getFirestore.mockReturnValue(db);
    firebaseAdmin.getAdmin.mockReturnValue({
      firestore: { FieldValue: { serverTimestamp: () => "__ts__" } },
    });

    await scenarioFirestore.saveScenarioContent("sid-2", [{ x: 1 }]);

    expect(batch.commit).toHaveBeenCalled();
    expect(firebaseStorageService.saveScenarioJsonSnapshot).toHaveBeenCalledWith("sid-2", [
      { x: 1 },
    ]);
  });

  test("saveScenarioContent chuẩn hóa content không phải mảng thành []", async () => {
    firebaseAdmin.isFirebaseReady.mockReturnValue(true);
    const { db, batch } = makeDocChain();
    firebaseAdmin.getFirestore.mockReturnValue(db);
    firebaseAdmin.getAdmin.mockReturnValue({
      firestore: { FieldValue: { serverTimestamp: () => "__ts__" } },
    });

    await scenarioFirestore.saveScenarioContent("sid-3", "not-array");

    expect(batch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ content: [] })
    );
    expect(firebaseStorageService.saveScenarioJsonSnapshot).toHaveBeenCalledWith("sid-3", []);
  });

  test("getScenarioContentArray trả null khi không có db", async () => {
    firebaseAdmin.getFirestore.mockReturnValue(null);

    const out = await scenarioFirestore.getScenarioContentArray("any");

    expect(out).toBeNull();
  });

  test("getScenarioContentArray trả null khi document không tồn tại", async () => {
    const { db } = makeDocChain({ exists: false });
    firebaseAdmin.getFirestore.mockReturnValue(db);

    const out = await scenarioFirestore.getScenarioContentArray("missing");

    expect(out).toBeNull();
  });

  test("getScenarioContentArray đọc content (lowercase) hoặc Content (legacy)", async () => {
    const { db: dbLower } = makeDocChain({
      exists: true,
      data: { content: [1] },
    });
    firebaseAdmin.getFirestore.mockReturnValue(dbLower);
    expect(await scenarioFirestore.getScenarioContentArray("a")).toEqual([1]);

    const { db: dbUpper } = makeDocChain({
      exists: true,
      data: { Content: [2] },
    });
    firebaseAdmin.getFirestore.mockReturnValue(dbUpper);
    expect(await scenarioFirestore.getScenarioContentArray("b")).toEqual([2]);

    const { db: dbBad } = makeDocChain({
      exists: true,
      data: { foo: "bar" },
    });
    firebaseAdmin.getFirestore.mockReturnValue(dbBad);
    expect(await scenarioFirestore.getScenarioContentArray("c")).toBeNull();
  });

  test("deleteScenarioContent no-op khi không có db", async () => {
    firebaseAdmin.getFirestore.mockReturnValue(null);

    await scenarioFirestore.deleteScenarioContent("sid");

    expect(firebaseStorageService.deleteScenarioJsonSnapshot).not.toHaveBeenCalled();
  });

  test("deleteScenarioContent xóa doc + snapshot", async () => {
    const { db, batch } = makeDocChain();
    firebaseAdmin.getFirestore.mockReturnValue(db);

    await scenarioFirestore.deleteScenarioContent("sid-9");

    expect(batch.delete).toHaveBeenCalled();
    expect(batch.commit).toHaveBeenCalled();
    expect(firebaseStorageService.deleteScenarioJsonSnapshot).toHaveBeenCalledWith("sid-9");
  });
});
