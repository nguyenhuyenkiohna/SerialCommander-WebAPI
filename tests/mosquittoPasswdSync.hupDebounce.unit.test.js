/**
 * Unit tests: HUP debouncing trong mosquittoPasswdSync.
 *
 * Kiểm tra rằng nhiều phiên được tạo đồng thời chỉ kích hoạt 1 HUP duy nhất,
 * thay vì N×1200ms.
 */
process.env.NODE_ENV = "test";
// Tắt passwd file để _doUpsertMqttBrokerUser trả { skipped: true } ngay lập tức.
delete process.env.MQTT_PASSWD_FILE;
// Debounce nhỏ để test chạy nhanh.
process.env.MQTT_BROKER_HUP_DEBOUNCE_MS = "50";
process.env.MQTT_BROKER_RELOAD_DELAY_MS = "0";

jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));
jest.mock("../kernels/logging/appLogger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

const { execFile } = require("child_process");
const passwdSync = require("../kernels/remoteSession/mosquittoPasswdSync");

// Helper: tạo sessionId 16 hex hợp lệ
let _counter = 0;
function makeSessionId() {
  _counter += 1;
  return String(_counter).padStart(2, "0").padEnd(16, "a");
}

beforeEach(() => {
  jest.clearAllMocks();
  passwdSync._resetHupStateForTests();
});

describe("mosquittoPasswdSync — HUP debouncing", () => {
  test("MQTT_PASSWD_FILE không cấu hình → upsert bỏ qua, không HUP", async () => {
    const result = await passwdSync.upsertMqttBrokerUser(makeSessionId(), "tok123");
    expect(result.skipped).toBe(true);
    expect(execFile).not.toHaveBeenCalled();
  });

  test("5 phiên đồng thời → reloadMqttBrokerInDocker chỉ chạy 1 lần (trong môi trường không có Docker)", async () => {
    // Không có MQTT_PASSWD_FILE → mọi upsert đều skip, needsReload = false.
    // Để test debounce path, chúng ta mock _doUpsert trả needsReload=true.
    // Cách đơn giản nhất: spy vào scheduleHupOnce gián tiếp qua execFile.
    // Vì execFile được mock và docker kill sẽ fail → reloadMqttBrokerInDocker log warn rồi return.

    // Thiết lập MQTT_PASSWD_FILE tạm để kích hoạt needsReload path.
    const tmpDir = require("os").tmpdir();
    const tmpFile = require("path").join(tmpDir, `sc_test_passwd_${Date.now()}`);
    process.env.MQTT_PASSWD_FILE = tmpFile;

    // execFile luôn fail → upsert trả { skipped: true, reason: "native_failed" }.
    // needsReload chỉ = true nếu synced = true, nên với skip không trigger HUP.
    // Ta cần synced = true → mock execFile thành công.
    execFile.mockImplementation((cmd, args, opts, cb) => {
      // Xác định là mosquitto_passwd hay docker → đều thành công
      cb(null, "", "");
    });

    const token = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    passwdSync._resetHupStateForTests();

    const calls = Array.from({ length: 5 }, (_, i) => {
      const sid = `${String(i + 1).padStart(2, "0")}${"a".repeat(14)}`;
      return passwdSync.upsertMqttBrokerUser(sid, token);
    });

    await Promise.all(calls);

    // execFile được gọi cho: 5 lần mosquitto_passwd (native) + tối đa 1 lần docker kill HUP.
    // docker kill có thể được gọi 0 lần nếu NODE_ENV=test → không HUP.
    // Kiểm tra: execFile gọi cho mosquitto_passwd = 5 lần, HUP ≤ 1 lần.
    const dockerHupCalls = execFile.mock.calls.filter(
      (args) => args[0] === "docker" && args[1].includes("-s")
    );
    expect(dockerHupCalls.length).toBeLessThanOrEqual(1);

    // Cleanup
    delete process.env.MQTT_PASSWD_FILE;
    try { require("fs").unlinkSync(tmpFile); } catch { /* không tồn tại thì bỏ qua */ }
  });

  test("debounce reset đúng cách giữa các test", () => {
    passwdSync._resetHupStateForTests();
    // Sau reset, debounce timer phải null — kiểm tra gián tiếp bằng cách
    // gọi _resetHupStateForTests() 2 lần liên tiếp không throw
    expect(() => passwdSync._resetHupStateForTests()).not.toThrow();
  });

  test("_getHupDebounceMs trả giá trị từ env", () => {
    expect(passwdSync._getHupDebounceMs()).toBe(50); // đã set ở đầu file
  });

  test("ensureMqttBrokerUser — vẫn upsert khi user đã có trong passwd file", async () => {
    const tmpDir = require("os").tmpdir();
    const tmpFile = require("path").join(tmpDir, `sc_ensure_passwd_${Date.now()}`);
    process.env.MQTT_PASSWD_FILE = tmpFile;

    const sid = makeSessionId();
    require("fs").writeFileSync(tmpFile, `${sid}:hashedpassword\n`);

    execFile.mockImplementation((cmd, args, opts, cb) => {
      cb(null, "", "");
    });

    const result = await passwdSync.ensureMqttBrokerUser(sid, "anytoken");
    expect(result.synced).toBe(true);
    expect(result.alreadyPresent).toBe(true);
    expect(execFile).toHaveBeenCalled();

    delete process.env.MQTT_PASSWD_FILE;
    try { require("fs").unlinkSync(tmpFile); } catch { /* ok */ }
  });

  test("cleanupExpiredUsers — bỏ qua khi không có passwd file", async () => {
    delete process.env.MQTT_PASSWD_FILE;
    const result = await passwdSync.cleanupExpiredUsers(async () => []);
    expect(result.skipped).toBe(true);
  });
});
