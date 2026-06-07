/**
 * Middleware xử lý lỗi tập trung (đặt sau mọi route).
 * Dùng next(err) trong handler async để tới đây (hoặc bọc bằng asyncHandler).
 */

const { logError } = require("../logging/appLogger");

function tracePayloadFragment(res) {
  const id = res.locals && res.locals.traceId;
  return id ? { trace_id: id } : {};
}

function validateOutgoingEnvelope(schema, payload) {
  if (process.env.VALIDATE_API_RESPONSES !== "1" || !schema) return;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    logError("API outbound response không khớp schema Zod", {
      issues: parsed.error.flatten ? parsed.error.flatten() : String(parsed.error),
    });
  }
}

function notFoundHandler(req, res) {
  const message = "Không tìm thấy tài nguyên hoặc đường dẫn API.";
  res.status(404).json({
    message,
    error: { code: "NOT_FOUND", message },
    path: req.originalUrl,
    ...tracePayloadFragment(res),
  });
}

function sendError(res, status, message, code = "BAD_REQUEST", details) {
  const payload = {
    message,
    error: {
      code,
      message,
    },
    ...tracePayloadFragment(res),
  };
  if (details !== undefined) {
    payload.error.details = details;
  }
  return res.status(status).json(payload);
}

/**
 * @param {unknown} responseSchema optional Zod schema — kiểm khi VALIDATE_API_RESPONSES=1
 */
function sendSuccess(res, status, message, data, responseSchema) {
  const payload = { message, ...tracePayloadFragment(res) };
  if (data && typeof data === "object" && !Array.isArray(data)) {
    Object.assign(payload, data);
  } else if (data !== undefined) {
    payload.data = data;
  }

  validateOutgoingEnvelope(responseSchema, payload);

  return res.status(status).json(payload);
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  let status = Number(err.statusCode || err.status || 500);
  if (err.message && String(err.message).startsWith("CORS:")) {
    status = 403;
  }
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const isProd = process.env.NODE_ENV === "production";

  const traceId = (res.locals && res.locals.traceId) || (req && req.traceId);
  if (!isProd) {
    logError("request error", { trace_id: traceId || undefined, err: err.message || String(err), stack: err.stack });
  } else if (safeStatus >= 500) {
    logError("server error", { trace_id: traceId || undefined, err: err.message || String(err) });
  }

  const clientMessage =
    safeStatus >= 500 && isProd
      ? "Lỗi server. Vui lòng thử lại sau."
      : err.message || "Lỗi server. Vui lòng thử lại sau.";

  const code = err.code || (safeStatus >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
  return sendError(res, safeStatus, clientMessage, code);
}

/**
 * Bọc handler async: (req,res,next) => Promise — lỗi sẽ được next(err).
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  notFoundHandler,
  errorHandler,
  asyncHandler,
  sendError,
  sendSuccess,
};
