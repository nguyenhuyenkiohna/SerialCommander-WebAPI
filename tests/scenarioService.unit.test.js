process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("models", () => ({
  Scenario: {
    create: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    destroy: jest.fn(),
    update: jest.fn(),
  },
  sequelize: {
    transaction: jest.fn(),
  },
}));

jest.mock("modules/config/services/scenarioFirestoreService", () => ({
  saveScenarioContent: jest.fn(),
  deleteScenarioContent: jest.fn(),
  getScenarioContentArray: jest.fn(),
  batchGetScenarioContentArrays: jest.fn(),
  batchSaveScenarioContent: jest.fn(),
  batchDeleteScenarioContent: jest.fn(),
}));

jest.mock("kernels/scenarioSyncStatus", () => ({
  getScenarioSyncStatus: jest.fn().mockResolvedValue(null),
  getScenarioSyncStatusBatch: jest.fn().mockResolvedValue(new Map()),
  setScenarioSyncStatus: jest.fn(),
}));

jest.mock("modules/config/services/scenarioSyncEnqueue", () => ({
  enqueueScenarioFirestoreSync: jest.fn(),
}));

const { Scenario, sequelize } = require("models");
const scenarioFirestore = require("modules/config/services/scenarioFirestoreService");
const scenarioSyncEnqueue = require("modules/config/services/scenarioSyncEnqueue");
const scenarioService = require("modules/config/services/scenarioService");

const validPayload = {
  Name: "S1",
  Description: "d",
  Content: JSON.stringify([{ Name: "step", Type: "raw", List: null, DefaultValue: null }]),
  Parity: "none",
  StopBits: 1,
  DataBits: 8,
  FlowControl: "none",
  NewLine: "none",
  Banners: [],
};

function mockTx() {
  const tx = { commit: jest.fn(), rollback: jest.fn() };
  sequelize.transaction.mockResolvedValue(tx);
  return tx;
}

describe("scenarioService (outbox Redis queue)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Scenario.create.mockReset();
    Scenario.findOne.mockReset();
    Scenario.update.mockReset();
    Scenario.destroy.mockReset();
    sequelize.transaction.mockReset();
    scenarioFirestore.getScenarioContentArray.mockReset();
    scenarioSyncEnqueue.enqueueScenarioFirestoreSync.mockReset();
  });

  test("createScenario: commit MySQL rồi enqueue Redis outbox, không gọi Firestore trực tiếp", async () => {
    const tx = mockTx();
    Scenario.create.mockResolvedValue({
      Id: "new-id",
      UserId: "u1",
      Name: "S1",
      dataValues: { Id: "new-id", UserId: "u1", Name: "S1" },
    });
    scenarioSyncEnqueue.enqueueScenarioFirestoreSync.mockResolvedValue(undefined);

    const out = await scenarioService.createScenario("u1", validPayload);

    expect(tx.commit.mock.invocationCallOrder[0]).toBeLessThan(
      scenarioSyncEnqueue.enqueueScenarioFirestoreSync.mock.invocationCallOrder[0]
    );
    expect(scenarioSyncEnqueue.enqueueScenarioFirestoreSync).toHaveBeenCalledWith(
      "scenario_upsert",
      "new-id",
      { content: expect.any(Array) }
    );
    expect(tx.rollback).not.toHaveBeenCalled();
    expect(scenarioFirestore.saveScenarioContent).not.toHaveBeenCalled();
    expect(out.syncStatus).toBe("pending");
  });

  test("createScenario: lỗi MySQL trong transaction → rollback, không enqueue", async () => {
    const tx = mockTx();
    const dbErr = new Error("db down");
    Scenario.create.mockRejectedValue(dbErr);

    await expect(scenarioService.createScenario("u1", validPayload)).rejects.toThrow("db down");
    expect(tx.rollback).toHaveBeenCalled();
    expect(tx.commit).not.toHaveBeenCalled();
    expect(scenarioSyncEnqueue.enqueueScenarioFirestoreSync).not.toHaveBeenCalled();
  });

  test("updateScenario: lỗi MySQL trong transaction → rollback, không enqueue", async () => {
    const tx = mockTx();
    Scenario.findOne.mockResolvedValueOnce({
      Id: "sid",
      UserId: "u",
      Name: "Old",
      Description: "",
      Baudrate: null,
      Parity: "none",
      StopBits: 1,
      DataBits: 8,
      FlowControl: "none",
      NewLine: "none",
      Banner1: null,
      Banner2: null,
    });
    Scenario.update.mockRejectedValue(new Error("db full"));

    await expect(
      scenarioService.updateScenario("sid", "u", validPayload)
    ).rejects.toThrow();

    expect(tx.rollback).toHaveBeenCalled();
    expect(tx.commit).not.toHaveBeenCalled();
    expect(scenarioSyncEnqueue.enqueueScenarioFirestoreSync).not.toHaveBeenCalled();
  });

  test("updateScenario: enqueue sau commit, không gọi Firestore trực tiếp", async () => {
    mockTx();
    Scenario.findOne.mockResolvedValueOnce({
      Id: "sid",
      UserId: "u",
      Name: "Old",
      Description: "",
      Baudrate: null,
      Parity: "none",
      StopBits: 1,
      DataBits: 8,
      FlowControl: "none",
      NewLine: "none",
      Banner1: null,
      Banner2: null,
    });
    Scenario.update.mockResolvedValue([1]);
    scenarioSyncEnqueue.enqueueScenarioFirestoreSync.mockResolvedValue(undefined);

    const out = await scenarioService.updateScenario("sid", "u", validPayload);

    expect(out.updatedRows).toBe(1);
    expect(out.syncStatus).toBe("pending");
    expect(scenarioSyncEnqueue.enqueueScenarioFirestoreSync).toHaveBeenCalledWith(
      "scenario_upsert",
      "sid",
      { content: expect.any(Array) }
    );
    expect(scenarioFirestore.saveScenarioContent).not.toHaveBeenCalled();
  });

  test("updateScenario: enqueue lỗi SAU commit → không throw, trả syncStatus degraded", async () => {
    const tx = mockTx();
    Scenario.findOne.mockResolvedValueOnce({
      Id: "sid",
      UserId: "u",
      Name: "Old",
      Description: "",
      Baudrate: null,
      Parity: "none",
      StopBits: 1,
      DataBits: 8,
      FlowControl: "none",
      NewLine: "none",
      Banner1: null,
      Banner2: null,
    });
    Scenario.update.mockResolvedValue([1]);
    const enqueueErr = new Error("Redis outbox enqueue failed");
    enqueueErr.statusCode = 503;
    scenarioSyncEnqueue.enqueueScenarioFirestoreSync.mockRejectedValue(enqueueErr);

    const out = await scenarioService.updateScenario("sid", "u", validPayload);

    expect(out.updatedRows).toBe(1);
    expect(out.syncStatus).toBe("degraded");
    expect(tx.commit).toHaveBeenCalled();
    expect(tx.rollback).not.toHaveBeenCalled();
  });

  test("createScenario: enqueue lỗi SAU commit → không throw, syncStatus degraded", async () => {
    const tx = mockTx();
    Scenario.create.mockResolvedValue({
      Id: "new-id",
      UserId: "u1",
      Name: "S1",
      dataValues: { Id: "new-id", UserId: "u1", Name: "S1" },
    });
    const enqueueErr = new Error("Redis outbox enqueue failed");
    enqueueErr.statusCode = 503;
    scenarioSyncEnqueue.enqueueScenarioFirestoreSync.mockRejectedValue(enqueueErr);

    const out = await scenarioService.createScenario("u1", validPayload);

    expect(out.Id).toBe("new-id");
    expect(out.syncStatus).toBe("degraded");
    expect(tx.commit).toHaveBeenCalled();
    expect(tx.rollback).not.toHaveBeenCalled();
  });

  test("deleteScenario: commit transaction rồi enqueue Redis (Outbox pattern)", async () => {
    const tx = mockTx();
    Scenario.destroy.mockResolvedValue(1);
    scenarioSyncEnqueue.enqueueScenarioFirestoreSync.mockResolvedValue(undefined);

    const out = await scenarioService.deleteScenario("sid", "u");

    expect(out.deletedRows).toBe(1);
    expect(out.syncStatus).toBe("pending");
    expect(scenarioSyncEnqueue.enqueueScenarioFirestoreSync).toHaveBeenCalledWith(
      "scenario_delete",
      "sid",
      null
    );
    expect(tx.commit).toHaveBeenCalled();
    expect(scenarioFirestore.deleteScenarioContent).not.toHaveBeenCalled();
  });

  test("getScenarioById 404 khi không có bản ghi", async () => {
    Scenario.findOne.mockResolvedValue(null);

    await expect(scenarioService.getScenarioById("x", "u")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test("getScenariosByUserId: batch Firestore + pagination", async () => {
    Scenario.findAndCountAll = jest.fn().mockResolvedValue({
      rows: [
        { dataValues: { Id: "i1", UserId: "u", Name: "A", Content: "" } },
        { dataValues: { Id: "i2", UserId: "u", Name: "B", Content: "" } },
      ],
      count: 12,
    });
    scenarioFirestore.batchGetScenarioContentArrays.mockResolvedValue(
      new Map([
        ["i1", [{ k: 1 }]],
        ["i2", null],
      ])
    );

    const out = await scenarioService.getScenariosByUserId("u", { limit: 2, offset: 4 });

    expect(Scenario.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2, offset: 4 })
    );
    expect(scenarioFirestore.batchGetScenarioContentArrays).toHaveBeenCalledWith(["i1", "i2"]);
    expect(scenarioFirestore.getScenarioContentArray).not.toHaveBeenCalled();
    expect(out.total).toBe(12);
    expect(out.limit).toBe(2);
    expect(out.offset).toBe(4);
    expect(JSON.parse(out.scenarios[0].Content)).toEqual([{ k: 1 }]);
    expect(JSON.parse(out.scenarios[1].Content)).toEqual([]);
  });

  test("attachScenarioContent: ưu tiên Firestore, fallback []", async () => {
    Scenario.findOne.mockResolvedValueOnce({
      dataValues: {
        Id: "i1",
        UserId: "u",
        Name: "N",
        Content: "",
      },
    });
    scenarioFirestore.getScenarioContentArray.mockResolvedValueOnce([{ k: 1 }]);

    const row = await scenarioService.getScenarioById("i1", "u");

    expect(JSON.parse(row.Content)).toEqual([{ k: 1 }]);
  });
});
