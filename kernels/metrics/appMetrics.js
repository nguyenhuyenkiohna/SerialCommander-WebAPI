/**
 * Metrics in-process + đồng bộ với query DB qua endpoint admin ops.
 */

const COUNTERS = Object.create(null);

/** Chuẩn latency rolling (last / avg / max) để Grafana alert “budget”. */
const LATENCY = Object.create(null);

function inc(counterName, delta = 1) {
  COUNTERS[counterName] = (COUNTERS[counterName] || 0) + delta;
}

function recordLatency(metricBaseName, ms) {
  const n = Number(ms);
  const safeMs = Number.isFinite(n) && n >= 0 ? n : 0;
  if (!LATENCY[metricBaseName]) {
    LATENCY[metricBaseName] = { sum: 0, count: 0, last: 0, max: 0 };
  }
  const d = LATENCY[metricBaseName];
  d.sum += safeMs;
  d.count += 1;
  d.last = safeMs;
  if (safeMs > d.max) {
    d.max = safeMs;
  }
}

function getLatencyGaugeSnapshot() {
  const out = {};
  for (const [name, d] of Object.entries(LATENCY)) {
    const prefix = `${name}`;
    out[`${prefix}_last_ms`] = Math.round(d.last);
    out[`${prefix}_avg_ms`] = d.count ? Math.round(d.sum / d.count) : 0;
    out[`${prefix}_max_ms`] = Math.round(d.max);
  }
  return out;
}

function getCountersSnapshot() {
  return { ...COUNTERS };
}

/**
 * exposition Prometheus nhỏ — counters (process) + gauges (DB Snapshot).
 */
function formatPrometheusExposition(gauges, countersSnapshot) {
  const lines = [];
  const ctr = countersSnapshot && typeof countersSnapshot === "object" ? countersSnapshot : getCountersSnapshot();
  for (const [name, val] of Object.entries(ctr)) {
    if (val === undefined || val === null) continue;
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${Number(val)}`);
  }
  for (const [name, val] of Object.entries(gauges || {})) {
    if (val === undefined || val === null) continue;
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${Number(val)}`);
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  inc,
  recordLatency,
  getLatencyGaugeSnapshot,
  getCountersSnapshot,
  formatPrometheusExposition,
};
