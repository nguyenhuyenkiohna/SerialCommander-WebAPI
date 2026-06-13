process.env.NODE_ENV = "production";
process.env.JWT_SECRET = "test-jwt-secret-passwd-gate";
process.env.SESSION_SECRET = "test-session-secret-passwd-gate";
process.env.FRONTEND_URL = "https://serial.toolhub.app";
process.env.MQTT_PASSWD_FILE = "docker/mosquitto/passwd";

require("rootpath")();

const remoteSessionController = require("modules/remote/controllers/remoteSessionController");
const remoteSessionService = require("modules/remote/services/remoteSessionService");

describe("remoteSessionController createSession passwd gate", () => {
  const prevMqttPasswdFile = process.env.MQTT_PASSWD_FILE;

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.MQTT_PASSWD_FILE = prevMqttPasswdFile;
    process.env.NODE_ENV = "production";
  });

  test("production + MQTT_PASSWD_FILE + sync fail → 503", async () => {
    jest.spyOn(remoteSessionService, "createRemoteSession").mockResolvedValue({
      sessionId: "a".repeat(16),
      mqttPasswordToken: "tok",
      envelopeToken: "env",
      joinChallenge: "b".repeat(32),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      ttlSeconds: 7200,
      topicPrefix: `serial/chat/${"a".repeat(16)}`,
      mqttBrokerPasswdSynced: false,
      mqttBrokerPasswdHint: "sync failed",
    });

    const req = { user: { id: 1 } };
    const res = {
      statusCode: 0,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };

    await remoteSessionController.createSession(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.body?.error?.code).toBe("MQTT_BROKER_PASSWD_SYNC_FAILED");
  });

  test("development + sync fail → vẫn 201 (dev broker không bắt buộc passwd)", async () => {
    process.env.NODE_ENV = "development";
    jest.spyOn(remoteSessionService, "createRemoteSession").mockResolvedValue({
      sessionId: "c".repeat(16),
      mqttPasswordToken: "tok",
      envelopeToken: "env",
      joinChallenge: "d".repeat(32),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      ttlSeconds: 7200,
      topicPrefix: `serial/chat/${"c".repeat(16)}`,
      mqttBrokerPasswdSynced: false,
    });

    const req = { user: { id: 2 } };
    const res = {
      statusCode: 0,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };

    await remoteSessionController.createSession(req, res);
    expect(res.statusCode).toBe(201);
  });
});
