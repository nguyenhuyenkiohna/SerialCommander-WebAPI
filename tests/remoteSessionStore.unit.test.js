process.env.NODE_ENV = "test";

jest.mock("../kernels/redis/redisClients", () => ({
  getSessionClient: jest.fn().mockReturnValue(null),
}));

jest.mock("../models", () => ({
  sequelize: {
    query: jest.fn().mockRejectedValue(new Error("No DB in test")),
  },
}));

const store = require("../kernels/remoteSession/remoteSessionStore");

describe("remoteSessionStore — timingSafeEqualString & verifySessionCredentials", () => {
  describe("timingSafeEqualString via verifyJoinChallenge", () => {
    it("returns true for same string", () => {
      const record = { joinChallenge: "abc123def456abc123def456abc12345" };
      expect(store.verifyJoinChallenge(record, "abc123def456abc123def456abc12345")).toBe(true);
    });

    it("returns false for different string of same length", () => {
      const record = { joinChallenge: "abc123def456abc123def456abc12345" };
      expect(store.verifyJoinChallenge(record, "xyz789def456abc123def456abc12345")).toBe(false);
    });

    it("returns false for shorter string — no timing leak (uses hash, no early return)", () => {
      const record = { joinChallenge: "abc123def456abc123def456abc12345" };
      expect(store.verifyJoinChallenge(record, "abc")).toBe(false);
    });

    it("returns false for longer string", () => {
      const record = { joinChallenge: "abc123" };
      expect(store.verifyJoinChallenge(record, "abc123extraextra")).toBe(false);
    });

    it("returns false when record missing joinChallenge", () => {
      expect(store.verifyJoinChallenge({}, "abc123")).toBe(false);
      expect(store.verifyJoinChallenge(null, "abc123")).toBe(false);
    });
  });

  describe("verifySessionCredentials", () => {
    const sessionId = "sess-unit-test-001";

    beforeEach(async () => {
      await store.saveSession(sessionId, {
        userId: 1,
        mqttPasswordToken: "correcttoken==",
        joinChallenge: "abc123def456abc123def456abc12345",
      });
    });

    it("returns true for correct token", async () => {
      const result = await store.verifySessionCredentials(sessionId, "correcttoken==");
      expect(result).toBe(true);
    });

    it("returns false for wrong token", async () => {
      const result = await store.verifySessionCredentials(sessionId, "wrongtoken===");
      expect(result).toBe(false);
    });

    it("returns false when session not found", async () => {
      const result = await store.verifySessionCredentials("nonexistent-session", "anytoken");
      expect(result).toBe(false);
    });
  });
});
