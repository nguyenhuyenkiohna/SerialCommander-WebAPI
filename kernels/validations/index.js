const { validationResult } = require("express-validator");
const { sendError } = require("../middlewares/errorHandler");

const validate = (validationArray) => {
  return async (req, res, next) => {
    // Kiểm tra xem validationArray có phải là một mảng không
    if (!Array.isArray(validationArray)) {
      return sendError(res, 422, "Validation must be an array", "VALIDATION_CONFIG_INVALID");
    }

    // Chạy từng validation trong validationArray
    for (let _validation of validationArray) {
      await _validation.run(req);
    }

    // Kiểm tra kết quả validation
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next(); // Không có lỗi, tiếp tục với middleware tiếp theo
    }

    return sendError(res, 422, "Validation failed", "VALIDATION_FAILED", {
      errors: errors.array(),
    });
  };
};

/**
 * Auth routes: trả message lỗi đầu tiên (tiếng Việt) thay vì chỉ "Validation failed".
 */
const validateAuth = (validationArray) => {
  return async (req, res, next) => {
    if (!Array.isArray(validationArray)) {
      return sendError(res, 422, "Validation must be an array", "VALIDATION_CONFIG_INVALID");
    }
    for (const rule of validationArray) {
      await rule.run(req);
    }
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }
    const first = errors.array()[0];
    const message =
      typeof first?.msg === "string" && first.msg.trim() ? first.msg.trim() : "Dữ liệu không hợp lệ";
    return sendError(res, 422, message, "VALIDATION_FAILED", {
      errors: errors.array(),
    });
  };
};

module.exports = { validate, validateAuth };
