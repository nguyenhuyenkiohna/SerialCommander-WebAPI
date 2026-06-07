const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("../../configs/envSecrets");
const { sendError } = require("./errorHandler");

/**
 * Xác thực thực phiên đã đăng nhập
 * @description HTTP Method có dạng
 *  authorization: token <mã lưu trong Local Storage>
 * @param {*} req 
 * @param {*} res    Nếu thất bại
 * @param {*} next   Nếu thành công
 */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  // Kiểm tra xem header có chứa token không
  if (!authHeader) {
    return sendError(res, 401, "Token không được cung cấp", "NO_TOKEN");
  }

  const [scheme, token] = String(authHeader).split(" ");
  if (scheme !== "Bearer" || !token) {
    return sendError(
      res,
      401,
      "Header Authorization phải có dạng: Bearer <token>",
      "AUTH_HEADER_INVALID"
    );
  }

  // Kiểm tra tính hợp lệ của token
  jwt.verify(token, getJwtSecret(), (err, decoded) => {
    if (err) {
      return sendError(res, 401, "Token không hợp lệ", "INVALID_TOKEN");
    }

    // Lưu thông tin người dùng vào request và tiếp tục
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