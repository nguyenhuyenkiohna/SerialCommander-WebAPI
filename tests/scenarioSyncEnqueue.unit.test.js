process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("kernels/scenarioSyncQueue", () => ({
  enqueueSync: jest.fn(),
  enqueueDelete: jest.fn(),
}));

const scenarioSyncQueue = require("kernels/scenarioSyncQueue");
const { enqueueScenarioFirestoreSync } = require("modules/config/services/scenarioSyncEnqueue");

describe("scenarioSyncEnqueue (redis outbox only)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("scenario_upsert → enqueueSync", async () => {
    await enqueueScenarioFirestoreSync("scenario_upsert", "id-1", { content: [{ a: 1 }] });
    expect(scenarioSyncQueue.enqueueSync).toHaveBeenCalledWith("id-1", [{ a: 1 }]);
  });

  test("scenario_delete → enqueueDelete", async () => {
    await enqueueScenarioFirestoreSync("scenario_delete", "id-2", null);
    expect(scenarioSyncQueue.enqueueDelete).toHaveBeenCalledWith("id-2");
  });

  test("từ chối enqueue trong transaction", async () => {
    await expect(
      enqueueScenarioFirestoreSync("scenario_upsert", "id-3", { content: [] }, { transaction: {} })
    ).rejects.toMatchObject({ code: "SCENARIO_SYNC_ENQUEUE_IN_TX" });
  });
});
