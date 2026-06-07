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
  batchSaveScenarioContent: jest.fn(),
  batchDeleteScenarioContent: jest.fn(),
}));

jest.mock("modules/config/services/scenarioSyncJobService", () => ({
  enqueue: jest.fn(),
}));

const { Scenario, sequelize } = require("models");
const scenarioFirestore = require("modules/config/services/scenarioFirestoreService");
const scenarioSyncJobService = require("modules/config/services/scenarioSyncJobService");
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
    scenarioSyncJobService.enqueue.mockReset();
    scenarioSyncJobService.enqueue.mockReset();
  });

  test("createScenario: transaction MySQL rồi enqueue Redis, không gọi Firestore trực tiếp", async () => {
    const tx = mockTx();
    Scenario.create.mockResolvedValue({
      Id: "new-id",
      UserId: "u1",
      Name: "S1",
      dataValues: { Id: "new-id", UserId: "u1", Name: "S1" },
    });
    scenarioSyncJobService.enqueue.mockResolvedValue(undefined);

    const out = await scenarioService.createScenario("u1", validPayload);

    expect(scenarioSyncJobService.enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      tx.commit.mock.invocationCallOrder[0]
    );
    expect(scenarioSyncJobService.enqueue).toHaveBeenCalledWith(
      "scenario_upsert",
      "new-id",
      { content: expect.any(Array) },
      null,
      { transaction: tx }
    );
    expect(tx.rollback).not.toHaveBeenCalled();
    expect(scenarioFirestore.saveScenarioContent).not.toHaveBeenCalled();
    expect(out.syncStatus).toBe("pending");
  });

  test("createScenario: lỗi enqueue trong transaction → giữ lỗi gốc và rollback", async () => {
    const tx = mockTx();
    Scenario.create.mockResolvedValue({
      Id: "new-id",
      dataValues: { Id: "new-id" },
    });
    const queueErr = new Error("db down");
    scenarioSyncJobService.enqueue.mockRejectedValue(queueErr);

    await expect(scenarioService.createScenario("u1", validPayload)).rejects.toThrow("db down");
    expect(tx.rollback).toHaveBeenCalled();
    expect(tx.commit).not.toHaveBeenCalled();
  });

  test("updateScenario: lỗi enqueue trong transaction → ném lỗi và rollback", async () => {
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
    const queueErr = new Error("db full");
    scenarioSyncJobService.enqueue.mockRejectedValue(queueErr);

    await expect(
      scenarioService.updateScenario("sid", "u", validPayload)
    ).rejects.toThrow();

    expect(tx.rollback).toHaveBeenCalled();
    expect(tx.commit).not.toHaveBeenCalled();
    expect(Scenario.update).toHaveBeenCalledTimes(1);
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
    scenarioSyncJobService.enqueue.mockResolvedValue(undefined);

    const n = await scenarioService.updateScenario("sid", "u", validPayload);

    expect(n).toBe(1);
    expect(scenarioSyncJobService.enqueue).toHaveBeenCalled();
    expect(scenarioFirestore.saveScenarioContent).not.toHaveBeenCalled();
  });

  test("deleteScenario: commit transaction rồi enqueue Redis (Outbox pattern)", async () => {
    const tx = mockTx();
    Scenario.destroy.mockResolvedValue(1);
    scenarioSyncJobService.enqueue.mockResolvedValue(undefined);

    const n = await scenarioService.deleteScenario("sid", "u");

    expect(n).toBe(1);
    expect(scenarioSyncJobService.enqueue).toHaveBeenCalledWith(
      "scenario_delete",
      "sid",
      null,
      null,
      { transaction: tx }
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
