/**
 * OpenTelemetry ( traces OTLP ) — bật khi OTEL_ENABLED=true, trước khi load Express.
 * Mặc định tắt metric/log SDK export kèm (chỉ trace) trừ khi set biến OTEL_* tương ứng.
 */

const { logWarn, logInfo } = require("../logging/appLogger");

function initTelemetry() {
  if (process.env.OTEL_ENABLED !== "true") {
    return;
  }

  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    logWarn("[otel] OTEL_ENABLED=true nhưng thiếu OTEL_EXPORTER_OTLP_ENDPOINT — bỏ qua init");
    return;
  }

  try {
    if (!process.env.OTEL_METRICS_EXPORTER) {
      process.env.OTEL_METRICS_EXPORTER = "none";
    }
    if (!process.env.OTEL_LOGS_EXPORTER) {
      process.env.OTEL_LOGS_EXPORTER = "none";
    }

    // eslint-disable-next-line global-require
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    // eslint-disable-next-line global-require
    const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
    // eslint-disable-next-line global-require
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
    // eslint-disable-next-line global-require
    const { Resource } = require("@opentelemetry/resources");
    // eslint-disable-next-line global-require
    const { ATTR_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");

    const exporter = new OTLPTraceExporter();
    const sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "serial-commander-webapi",
      }),
      traceExporter: exporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
        }),
      ],
    });

    sdk.start();
    logInfo("[otel] NodeSDK đã khởi động (traces OTLP)");

    process.once("SIGTERM", () =>
      sdk
        .shutdown()
        .catch(() => {})
    );
  } catch (e) {
    logWarn("[otel] init thất bại", { error: String(e.message || e) });
  }
}

module.exports = { initTelemetry };
