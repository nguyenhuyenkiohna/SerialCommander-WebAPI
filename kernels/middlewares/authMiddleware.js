const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("../../configs/envSecrets");
const { sendError } = require("./errorHandler");

const AUTH_COOKIE_NAME = "sc_auth_token";

/**
 * Parse cookie header thủ công — không cần cookie-parser package.
 * Trả về giá trị cookie sc_auth_token nếu có.
 */
function extractTokenFromCookie(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === AUTH_COOKIE_NAME) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/**
 * Xác thực phiên đã đăng nhập.
 * Ưu tiên đọc JWT từ HttpOnly cookie sc_auth_token; fallback về Authorization: Bearer <token>.
 * Cookie là phương thức ưu tiên (chống XSS); Bearer vẫn được hỗ trợ cho backward-compat.
 */
const verifyToken = (req, res, next) => {
  // 1. Thử đọc từ HttpOnly cookie trước
  const cookieToken = extractTokenFromCookie(req);
  if (cookieToken) {
    return jwt.verify(cookieToken, getJwtSecret(), (err, decoded) => {
      if (err) {
        return sendError(res, 401, "Token không hợp lệ", "INVALID_TOKEN");
      }
      req.user = decoded;
      next();
    });
  }

  // 2. Fallback: Authorization: Bearer <token> (tắt mặc định trên production)
  const allowBearer =
    process.env.ALLOW_BEARER_AUTH === "true" || process.env.NODE_ENV !== "production";
  if (!allowBearer) {
    return sendError(
      res,
      401,
      "Token không được cung cấp. Đăng nhập qua cookie HttpOnly.",
      "BEARER_AUTH_DISABLED"
    );
  }

  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return sendError(res, 401, "Token không được cung cấp", "NO_TOKEN");
  }

  const [scheme, bearerToken] = String(authHeader).split(" ");
  if (scheme !== "Bearer" || !bearerToken) {
    return sendError(
      res,
      401,
      "Header Authorization phải có dạng: Bearer <token>",
      "AUTH_HEADER_INVALID"
    );
  }

  jwt.verify(bearerToken, getJwtSecret(), (err, decoded) => {
    if (err) {
      return sendError(res, 401, "Token không hợp lệ", "INVALID_TOKEN");
    }
    req.user = decoded;
    next();
  });
};

const verifyAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return sendError(res, 403, "Bạn không có quyền truy cập admin", "FORBIDDEN");
  }
  next();
};

module.exports = { verifyToken, verifyAdmin };