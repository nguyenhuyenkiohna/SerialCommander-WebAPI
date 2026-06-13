/**
 * Unit tests: refreshTokenService
 *
 * Kiểm tra:
 *  - issueRefreshToken tạo JWT hợp lệ với type="refresh"
 *  - verifyRefreshToken xác thực đúng
 *  - verifyRefreshToken trả null khi token bị sửa
 *  - verifyRefreshToken trả null khi Redis revoked
 *  - revokeRefreshToken xóa key khỏi Redis
 *  - revokeAllRefreshTokens xóa tất cả key theo prefix userId
 */
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-refresh-service-unit-test-min-32chars";

const mockRedisData = new Map();
const mockClient = {
  status: "ready",
  connect: jest.fn(),
  get: jest.fn().mockImplementation((key) => Promise.resolve(mockRedisData.get(key) ?? null)),
  set: jest.fn().mockImplementation((key, value) => {
    mockRedisData.set(key, value);
    return Promise.resolve("OK");
  }),
  del: jest.fn().mockImplementation((...keys) => {
    for (const k of keys) mockRedisData.delete(k);
    return Promise.resolve(keys.length);
  }),
  scan: jest.fn().mockImplementation(async (cursor, _match, pattern) => {
    const prefix = pattern.replace("*", "");
    const found = [...mockRedisData.keys()].filter((k) => k.startsWith(prefix));
    return ["0", found];
  }),
};

jest.mock("../kernels/redis/redisClients", () => ({
  getSessionClient: jest.fn().mockReturnValue(mockClient),
}));

jest.mock("../kernels/logging/appLogger", () => ({
  logWarn: jest.fn(),
  logInfo: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const service = require("../modules/auth/services/refreshTokenService");

beforeEach(() => {
  mockRedisData.clear();
  jest.clearAllMocks();
  mockClient.get.mockImplementation((key) => Promise.resolve(mockRedisData.get(key) ?? null));
  mockClient.set.mockImplementation((key, value) => {
    mockRedisData.set(key, value);
    return Promise.resolve("OK");
  });
  mockClient.del.mockImplementation((...keys) => {
    for (const k of keys) mockRedisData.delete(k);
    return Promise.resolve(keys.length);
  });
});

describe("refreshTokenService — issueRefreshToken", () => {
  test("trả về JWT string có type=refresh và id=userId", async () => {
    const token = await service.issueRefreshToken(42);
    expect(typeof token).toBe("string");
    const payload = jwt.decode(token);
    expect(payload.type).toBe("refresh");
    expect(payload.id).toBe(42);
    expect(typeof payload.tokenId).toBe("string");
    expect(payload.tokenId.length).toBeGreaterThan(0);
  });

  test("lưu hash token vào Redis", async () => {
    await service.issueRefreshToken(10);
    expect(mockClient.set).toHaveBeenCalledTimes(1);
    const [key, storedHash] = mockClient.set.mock.calls[0];
    expect(key).toMatch(/^auth:refresh:10:/);
    expect(typeof storedHash).toBe("string");
    expect(storedHash.length).toBeGreaterThan(10); // SHA-256 hex = 64 chars
  });
});

describe("refreshTokenService — verifyRefreshToken", () => {
  test("trả payload khi token hợp lệ và tồn tại trong Redis", async () => {
    const token = await service.issueRefreshToken(7);
    const result = await service.verifyRefreshToken(token);
    expect(result).not.toBeNull();
    expect(result.userId).toBe(7);
    expect(typeof result.tokenId).toBe("string");
  });

  test("trả null khi chữ ký JWT bị sửa", async () => {
    const token = await service.issueRefreshToken(7);
    const tampered = token.slice(0, -5) + "XXXXX";
    const result = await service.verifyRefreshToken(tampered);
    expect(result).toBeNull();
  });

  test("trả null khi type không phải refresh", async () => {
    const badToken = jwt.sign(
      { id: 5, tokenId: "abc", type: "access" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    expect(await service.verifyRefreshToken(badToken)).toBeNull();
  });

  test("trả null khi Redis không có key (đã bị revoke)", async () => {
    const token = await service.issueRefreshToken(9);
    mockRedisData.clear(); // xóa toàn bộ → Redis miss
    const result = await service.verifyRefreshToken(token);
    expect(result).toBeNull();
  });

  test("trả null khi hash Redis không khớp (token bị thay thế)", async () => {
    const token = await service.issueRefreshToken(11);
    // Ghi đè hash trong Redis bằng giá trị sai
    const key = [...mockRedisData.keys()][0];
    mockRedisData.set(key, "wronghash");
    expect(await service.verifyRefreshToken(token)).toBeNull();
  });
});

describe("refreshTokenService — revokeRefreshToken", () => {
  test("xóa key khỏi Redis → verifyRefreshToken trả null sau đó", async () => {
    const token = await service.issueRefreshToken(3);
    const payload = jwt.decode(token);
    await service.revokeRefreshToken(3, payload.tokenId);
    expect(await service.verifyRefreshToken(token)).toBeNull();
  });
});

describe("refreshTokenService — revokeAllRefreshTokens", () => {
  test("xóa tất cả keys theo prefix userId", async () => {
    await service.issueRefreshToken(20);
    await service.issueRefreshToken(20);
    await service.issueRefreshToken(99); // userId khác

    await service.revokeAllRefreshTokens(20);

    // Keys của userId 20 phải bị xóa
    const remaining = [...mockRedisData.keys()];
    const userId20Keys = remaining.filter((k) => k.startsWith("auth:refresh:20:"));
    expect(userId20Keys).toHaveLength(0);

    // Key userId 99 phải còn
    const userId99Keys = remaining.filter((k) => k.startsWith("auth:refresh:99:"));
    expect(userId99Keys).toHaveLength(1);
  });
});
