/**
 * Telemetry optional — không bật OTEL trong Jest trừ khi test explicit.
 */

process.env.NODE_ENV = "test";

describe("initTelemetry", () => {
  test("OTEL không bật thì không ném và không khởi tạo", () => {
    delete process.env.OTEL_ENABLED;
    jest.isolateModules(() => {
      const { initTelemetry } = require("../kernels/telemetry/initOtel");
      expect(() => initTelemetry()).not.toThrow();
    });
  });

  test("OTEL_ENABLED thiếu endpoint thì bỏ qua an toàn", () => {
    const prevEnabled = process.env.OTEL_ENABLED;
    const prevEp = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    try {
      process.env.OTEL_ENABLED = "true";
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
      jest.isolateModules(() => {
        const { initTelemetry } = require("../kernels/telemetry/initOtel");
        expect(() => initTelemetry()).not.toThrow();
      });
    } finally {
      if (prevEnabled !== undefined) process.env.OTEL_ENABLED = prevEnabled;
      else delete process.env.OTEL_ENABLED;
      if (prevEp !== undefined) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEp;
    }
  });
});
