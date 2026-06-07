process.env.NODE_ENV = "test";

require("rootpath")();

const remoteSessionService = require("modules/remote/services/remoteSessionService");

describe("remoteSessionService", () => {
  /** Không đụng passwd thật khi máy dev đã exports MQTT_PASSWD_FILE vào shell. */
  const prevMqttPasswdFile = process.env.MQTT_PASSWD_FILE;
  beforeAll(() => {
    delete process.env.MQTT_PASSWD_FILE;
  });
  afterAll(() => {
    if (prevMqttPasswdFile !== undefined) process.env.MQTT_PASSWD_FILE = prevMqttPasswdFile;
    else delete process.env.MQTT_PASSWD_FILE;
  });

  test("createRemoteSession trả sessionId, mqttPasswordToken và joinChallenge", async () => {
    const session = await remoteSessionService.createRemoteSession(42);
    expect(session.sessionId).toMatch(/^[a-f0-9]{16}$/);
    expect(session.joinChallenge).toMatch(/^[a-f0-9]{32}$/);
    expect(session.mqttPasswordToken.length).toBeGreaterThan(20);
    expect(session.ttlSeconds).toBeGreaterThan(0);
    expect(session.topicPrefix).toBe(`serial/chat/${session.sessionId}`);
    expect(typeof session.mqttBrokerPasswdSynced).toBe("boolean");
  });

  test("verifyRemoteSession đúng/sai token", async () => {
    const session = await remoteSessionService.createRemoteSession(7);
    const ok = await remoteSessionService.verifyRemoteSession(
      session.sessionId,
      session.mqttPasswordToken
    );
    const bad = await remoteSessionService.verifyRemoteSession(session.sessionId, "wrong-token");
    expect(ok).toBe(true);
    expect(bad).toBe(false);
  });

  test("isAuthorizedForCredentials: host theo userId", async () => {
    const session = await remoteSessionService.createRemoteSession(99);
    const record = await remoteSessionService.getSessionRecord(session.sessionId);
    expect(remoteSessionService.isAuthorizedForCredentials(record, 99, null)).toBe(true);
    expect(remoteSessionService.isAuthorizedForCredentials(record, 1, null)).toBe(false);
  });

  test("isAuthorizedForCredentials: station với joinChallenge hợp lệ", async () => {
    const session = await remoteSessionService.createRemoteSession(5);
    const record = await remoteSessionService.getSessionRecord(session.sessionId);
    expect(
      remoteSessionService.isAuthorizedForCredentials(record, 999, session.joinChallenge)
    ).toBe(true);
    expect(
      remoteSessionService.isAuthorizedForCredentials(record, 999, "0".repeat(32))
    ).toBe(false);
  });

  test("buildSessionCredentials trả mqttPasswordToken", async () => {
    const session = await remoteSessionService.createRemoteSession(3);
    const record = await remoteSessionService.getSessionRecord(session.sessionId);
    const creds = remoteSessionService.buildSessionCredentials(session.sessionId, record);
    expect(creds.mqttPasswordToken).toBe(session.mqttPasswordToken);
  });

  test("normalizeSessionId từ chối mã 6 ký tự cũ", () => {
    expect(remoteSessionService.normalizeSessionId("abc123")).toBeNull();
    expect(remoteSessionService.normalizeSessionId("a".repeat(16))).toBe("a".repeat(16));
  });

  test("getSessionRecord null khi phòng không tồn tại", async () => {
    const missing = await remoteSessionService.getSessionRecord("b".repeat(16));
    expect(missing).toBeNull();
  });
});
