const crypto = require("crypto");

const INCOMING_HEADER_NAMES = ["x-request-id", "x-trace-id"];

/**
 * Trích trace-id 32 hex từ W3C traceparent: 00-{trace-id}-{parent-id}-{flags}
 */
function traceIdFromTraceparent(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return null;
  const m = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i.exec(headerValue.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Cho phép client gửi id tùy chọn (UUID, ulid, v.v.) — giới hạn độ dài và ký tự an toàn.
 */
function sanitizeClientTraceId(raw) {
  const s = String(raw).trim();
  if (s.length < 4 || s.length > 128) return null;
  if (!/^[a-zA-Z0-9._\-:+]+$/.test(s)) return null;
  return s;
}

function resolveTraceId(req) {
  for (const name of INCOMING_HEADER_NAMES) {
    const v = req.headers[name];
    if (typeof v === "string") {
      const id = sanitizeClientTraceId(v);
      if (id) return id;
    }
  }
  const tp = req.headers.traceparent;
  if (typeof tp === "string") {
    const fromTp = traceIdFromTraceparent(tp);
    if (fromTp) return fromTp;
  }
  return crypto.randomUUID();
}

/**
 * Gắn trace_id cho request (req.traceId, res.locals.traceId) và header phản hồi X-Request-Id.
 * Hỗ trợ bắc cầu với log / hỗ trợ khách hàng khi báo lỗi.
 */
function requestTraceMiddleware(req, res, next) {
  const traceId = resolveTraceId(req);
  req.traceId = traceId;
  res.locals.traceId = traceId;
  res.setHeader("X-Request-Id", traceId);
  next();
}

module.exports = {
  requestTraceMiddleware,
  resolveTraceId,
};
