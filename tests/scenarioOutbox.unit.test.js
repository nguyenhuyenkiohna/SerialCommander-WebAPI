process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("kernels/scenarioSyncStatus", () => ({
  setScenarioSyncStatus: jest.fn().mockResolvedValue(undefined),
  recordFirestoreBatchSuccess: jest.fn(),
  recordFirestoreBatchFailure: jest.fn().mockResolvedValue(false),
}));

jest.mock("kernels/scenarioSyncQueue", () => ({
  claimBatch: jest.fn(),
  ackBatch: jest.fn(),
  requeueBatch: jest.fn(),
  acquireOutboxLock: jest.fn(),
  releaseOutboxLock: jest.fn(),
  ACTIONS: {
    SYNC_FIRESTORE: "SYNC_FIRESTORE",
    DELETE_FIRESTORE: "DELETE_FIRESTORE",
  },
}));

jest.mock("modules/config/services/scenarioFirestoreService", () => ({
  batchSaveScenarioContent: jest.fn(),
  batchDeleteScenarioContent: jest.fn(),
}));

const scenarioSyncQueue = require("kernels/scenarioSyncQueue");
const scenarioFirestore = require("modules/config/services/scenarioFirestoreService");
const { processQueueBatch, __private } = require("kernels/syncJob");

describe("syncJob outbox worker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __private.resetBackoffState();
    scenarioSyncQueue.acquireOutboxLock.mockResolvedValue(true);
    scenarioSyncQueue.releaseOutboxLock.mockResolvedValue(undefined);
    scenarioSyncQueue.ackBatch.mockResolvedValue(undefined);
    scenarioSyncQueue.requeueBatch.mockResolvedValue(undefined);
  });

  test("processQueueBatch: claim → Firestore → ack", async () => {
    const raws = ["raw-a", "raw-b", "raw-c"];
    scenarioSyncQueue.claimBatch.mockResolvedValue({
      items: [
        { scenarioId: "a", content: [{ x: 1 }], action: "SYNC_FIRESTORE" },
        { scenarioId: "b", content: [], action: "SYNC_FIRESTORE" },
        { scenarioId: "c", action: "DELETE_FIRESTORE" },
      ],
      raws,
    });
    scenarioFirestore.batchSaveScenarioContent.mockResolvedValue(undefined);
    scenarioFirestore.batchDeleteScenarioContent.mockResolvedValue(undefined);

    await processQueueBatch();

    expect(scenarioSyncQueue.acquireOutboxLock).toHaveBeenCalled();
    expect(scenarioFirestore.batchSaveScenarioContent).toHaveBeenCalledWith([
      { scenarioId: "a", content: [{ x: 1 }] },
      { scenarioId: "b", content: [] },
    ]);
    expect(scenarioFirestore.batchDeleteScenarioContent).toHaveBeenCalledWith(["c"]);
    expect(scenarioSyncQueue.ackBatch).toHaveBeenCalledWith(raws);
    expect(scenarioSyncQueue.requeueBatch).not.toHaveBeenCalled();
    expect(scenarioSyncQueue.releaseOutboxLock).toHaveBeenCalled();
  });

  test("processQueueBatch: Firestore lỗi → requeue, không ack", async () => {
    const raws = ["raw-1"];
    scenarioSyncQueue.claimBatch.mockResolvedValue({
      items: [{ scenarioId: "x", content: [], action: "SYNC_FIRESTORE" }],
      raws,
    });
    scenarioFirestore.batchSaveScenarioContent.mockRejectedValue(new Error("firestore down"));

    await processQueueBatch();

    expect(scenarioSyncQueue.ackBatch).not.toHaveBeenCalled();
    expect(scenarioSyncQueue.requeueBatch).toHaveBeenCalledWith(raws);
  });

  test("processQueueBatch: lỗi liên tiếp kích hoạt backoff, lần gọi ngay sau bị bỏ qua", async () => {
    scenarioSyncQueue.claimBatch.mockResolvedValue({
      items: [{ scenarioId: "x", content: [], action: "SYNC_FIRESTORE" }],
      raws: ["raw-1"],
    });
    scenarioFirestore.batchSaveScenarioContent.mockRejectedValue(new Error("firestore down"));

    await processQueueBatch();
    await processQueueBatch();

    expect(scenarioSyncQueue.claimBatch).toHaveBeenCalledTimes(1);
    expect(__private.getBackoffState().consecutiveFailureCount).toBe(1);
  });

  test("processQueueBatch: không lock → bỏ qua", async () => {
    scenarioSyncQueue.acquireOutboxLock.mockResolvedValue(false);

    await processQueueBatch();

    expect(scenarioSyncQueue.claimBatch).not.toHaveBeenCalled();
  });

  test("processQueueBatch no-op khi queue rỗng", async () => {
    scenarioSyncQueue.claimBatch.mockResolvedValue({ items: [], raws: [] });

    await processQueueBatch();

    expect(scenarioFirestore.batchSaveScenarioContent).not.toHaveBeenCalled();
    expect(scenarioSyncQueue.ackBatch).not.toHaveBeenCalled();
  });
});
