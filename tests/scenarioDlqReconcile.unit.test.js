process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("models", () => ({
  Scenario: {
    findByPk: jest.fn(),
  },
}));

jest.mock("kernels/scenarioSyncQueue", () => ({
  ACTIONS: {
    SYNC_FIRESTORE: "SYNC_FIRESTORE",
    DELETE_FIRESTORE: "DELETE_FIRESTORE",
  },
  peekDlq: jest.fn(),
  removeFromDlq: jest.fn(),
  enqueueSync: jest.fn(),
  enqueueDelete: jest.fn(),
}));

jest.mock("kernels/scenarioSyncStatus", () => ({
  setScenarioSyncStatus: jest.fn(),
}));

const { Scenario } = require("models");
const scenarioSyncQueue = require("kernels/scenarioSyncQueue");
const scenarioSyncStatus = require("kernels/scenarioSyncStatus");
const {
  reconcileDlqItem,
  reconcileDlqBatch,
  parseContentFromRow,
} = require("kernels/scenarioDlqReconcile");

describe("scenarioDlqReconcile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    scenarioSyncQueue.removeFromDlq.mockResolvedValue(undefined);
    scenarioSyncQueue.enqueueSync.mockResolvedValue(undefined);
    scenarioSyncQueue.enqueueDelete.mockResolvedValue(undefined);
    scenarioSyncStatus.setScenarioSyncStatus.mockResolvedValue(undefined);
  });

  test("parseContentFromRow: parse JSON array hợp lệ", () => {
    expect(parseContentFromRow({ Content: JSON.stringify([{ a: 1 }]) })).toEqual([{ a: 1 }]);
    expect(parseContentFromRow({ Content: "not-json" })).toEqual([]);
    expect(parseContentFromRow({ Content: null })).toEqual([]);
  });

  test("reconcileDlqItem SYNC: đọc MySQL và re-enqueue content mới", async () => {
    Scenario.findByPk.mockResolvedValue({
      Content: JSON.stringify([{ step: 1 }]),
    });

    const result = await reconcileDlqItem({
      raw: "raw-1",
      parsed: {
        scenarioId: "abc",
        action: "SYNC_FIRESTORE",
        retryCount: 5,
      },
    });

    expect(result).toEqual({ outcome: "upsert_requeued_from_mysql", scenarioId: "abc" });
    expect(scenarioSyncQueue.removeFromDlq).toHaveBeenCalledWith("raw-1");
    expect(scenarioSyncQueue.enqueueSync).toHaveBeenCalledWith("abc", [{ step: 1 }]);
    expect(scenarioSyncStatus.setScenarioSyncStatus).toHaveBeenCalledWith("abc", "pending");
  });

  test("reconcileDlqItem SYNC: scenario không còn trong MySQL → enqueue delete", async () => {
    Scenario.findByPk.mockResolvedValue(null);

    const result = await reconcileDlqItem({
      raw: "raw-2",
      parsed: { scenarioId: "gone", action: "SYNC_FIRESTORE" },
    });

    expect(result.outcome).toBe("upsert_missing_mysql_enqueue_delete");
    expect(scenarioSyncQueue.enqueueDelete).toHaveBeenCalledWith("gone");
  });

  test("reconcileDlqItem DELETE: MySQL đã xóa → xác nhận success", async () => {
    Scenario.findByPk.mockResolvedValue(null);

    const result = await reconcileDlqItem({
      raw: "raw-3",
      parsed: { scenarioId: "del-1", action: "DELETE_FIRESTORE" },
    });

    expect(result.outcome).toBe("delete_confirmed");
    expect(scenarioSyncStatus.setScenarioSyncStatus).toHaveBeenCalledWith("del-1", "success");
    expect(scenarioSyncQueue.enqueueDelete).not.toHaveBeenCalled();
  });

  test("reconcileDlqBatch: xử lý nhiều entry từ peekDlq", async () => {
    scenarioSyncQueue.peekDlq.mockResolvedValue([
      { raw: "r1", parsed: { scenarioId: "s1", action: "SYNC_FIRESTORE" } },
    ]);
    Scenario.findByPk.mockResolvedValue({ Content: "[]" });

    const results = await reconcileDlqBatch(5);
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("upsert_requeued_from_mysql");
  });
});
