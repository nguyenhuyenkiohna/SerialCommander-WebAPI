/**
 * Structured logging khi LOG_FORMAT=json (JSON Lines), ngược lại dòng text trên terminal.
 */

const LEVELS = ["debug", "info", "warn", "error"];

function isJsonLogs() {
  return String(process.env.LOG_FORMAT || "").toLowerCase() === "json";
}

function baseRecord(level, message, meta = {}) {
  return {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
}

function emit(record) {
  if (isJsonLogs()) {
    process.stdout.write(`${JSON.stringify(record)}\n`);
    return;
  }

  const prefix = `${record.ts} [${record.level}] ${record.message}`;
  const { ts, level, message, ...meta } = record;
  const hasMeta = Object.keys(meta).some((k) => meta[k] !== undefined);
  if (record.level === "error") {
    if (hasMeta) console.error(prefix, meta);
    else console.error(prefix);
  } else if (hasMeta) {
    console.log(prefix, meta);
  } else {
    console.log(prefix);
  }
}

function log(level, message, meta) {
  const idx = LEVELS.indexOf(level);
  const minLabel = process.env.LOG_LEVEL || "debug";
  const minIdx = LEVELS.includes(minLabel) ? LEVELS.indexOf(minLabel) : 0;
  if (idx < minIdx) return;
  emit(baseRecord(level, message, meta));
}

module.exports = {
  logDebug: (msg, meta) => log("debug", msg, meta),
  logInfo: (msg, meta) => log("info", msg, meta),
  logWarn: (msg, meta) => log("warn", msg, meta),
  logError: (msg, meta) => log("error", msg, meta),
  isJsonLogs,
};
