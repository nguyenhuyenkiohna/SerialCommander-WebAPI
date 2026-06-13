/**
 * Contract: cấu hình Mosquitto WSS dev + prod có listener TLS và cert paths.
 */
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");

function readConf(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

describe("mosquitto WSS configuration", () => {
  test("docker/mosquitto/mosquitto.wss.conf — listener 9443 + cert files", () => {
    const conf = readConf("docker/mosquitto/mosquitto.wss.conf");
    expect(conf).toMatch(/listener\s+9443/);
    expect(conf).toMatch(/protocol\s+websockets/);
    expect(conf).toMatch(/certfile\s+\/mosquitto\/certs\/server\.crt/);
    expect(conf).toMatch(/keyfile\s+\/mosquitto\/certs\/server\.key/);
    expect(conf).not.toMatch(/listener\s+9001/);
  });

  test("scripts/mqtt-prod/mosquitto.conf — listener 8884 TLS cho production", () => {
    const conf = readConf("SerialCommander-WebAPI-main/scripts/mqtt-prod/mosquitto.conf");
    expect(conf).toMatch(/listener\s+8884/);
    expect(conf).toMatch(/protocol\s+websockets/);
    expect(conf).toMatch(/certfile\s+\/mosquitto\/certs\//);
    expect(conf).toMatch(/bind_address\s+127\.0\.0\.1/);
  });

  test("docker-compose.wss.yml — publish 9443, dùng mosquitto.wss.conf", () => {
    const compose = readConf("docker-compose.wss.yml");
    expect(compose).toMatch(/MQTT_WSS_PORT.*9443/);
    expect(compose).not.toMatch(/9001:9001/);
    expect(compose).toMatch(/mosquitto\.wss\.conf/);
  });
});
