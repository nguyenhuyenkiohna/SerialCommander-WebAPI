const { User } = require("../../../models");
const { sendEmailVerificationCodeEmail } = require("../../../utils/emailService");
const { createOtpCode } = require("./authDomainService");
const {
  removeLegacyUnverifiedLocalUser,
  upsertPendingRegistration,
  resolveRegistrationUsername,
} = require("./pendingRegistrationService");
const {
  assertValidEmail,
  validatePassword,
} = require("../../../utils/emailValidation");

function createAppError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function registerLocalUser({ password, email, username }) {
  const normalizedEmail = assertValidEmail(email);
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.ok) {
    throw createAppError(400, "AUTH_PASSWORD_WEAK", passwordCheck.message);
  }

  const existingUser = await User.findOne({ where: { email: normalizedEmail } });
  if (existingUser) {
    if (existingUser.provider === "local" && existingUser.isVerified !== true) {
      await removeLegacyUnverifiedLocalUser(normalizedEmail);
    } else {
      throw createAppError(
        400,
        "AUTH_EMAIL_EXISTS",
        "Email này đã được sử dụng. Vui lòng sử dụng email khác hoặc đăng nhập."
      );
    }
  }

  await removeLegacyUnverifiedLocalUser(normalizedEmail);

  if (username) {
    await resolveRegistrationUsername(normalizedEmail, username);
  }

  const verifyCode = createOtpCode();
  await upsertPendingRegistration(normalizedEmail, password, verifyCode);

  let emailSent = true;
  let devOtp;
  try {
    const mailResult = await sendEmailVerificationCodeEmail(normalizedEmail, verifyCode);
    if (mailResult.devLogged) {
      emailSent = false;
      if (process.env.NODE_ENV !== "production") {
        devOtp = verifyCode;
      }
    }
  } catch (_error) {
    emailSent = false;
  }

  return { email: normalizedEmail, emailSent, devOtp };
}

function mapRegisterError(error) {
  const sqlMsg = error.parent?.sqlMessage || "";

  if (error.status && error.code) {
    return { status: error.status, code: error.code, message: error.message };
  }

  if (sqlMsg && (/Unknown column/i.test(sqlMsg) || /doesn't exist/i.test(sqlMsg))) {
    return {
      status: 500,
      code: "DB_SCHEMA",
      message:
        "Lỗi cơ sở dữ liệu khi đăng ký (schema có thể chưa đồng bộ). Chạy migration PendingRegistrations (schema v12).",
    };
  }

  if (error.name === "SequelizeUniqueConstraintError" || error.code === "ER_DUP_ENTRY") {
    if (error.fields && error.fields.email) {
      return {
        status: 400,
        code: "AUTH_EMAIL_EXISTS",
        message: "Email này đã được sử dụng. Vui lòng sử dụng email khác hoặc đăng nhập.",
      };
    }
    return {
      status: 400,
      code: "AUTH_DUPLICATE",
      message: "Thông tin đăng ký đã tồn tại trong hệ thống",
    };
  }

  if (error.name === "SequelizeValidationError") {
    const hasEmailError = error.errors?.some((e) => e.path === "email");
    return {
      status: 400,
      code: hasEmailError ? "AUTH_INVALID_EMAIL" : "AUTH_VALIDATION",
      message: hasEmailError ? "Email không hợp lệ" : error.errors.map((e) => e.message).join(", "),
    };
  }

  return {
    status: 500,
    code: "AUTH_REGISTER_FAILED",
    message: "Lỗi server. Vui lòng thử lại sau.",
  };
}

module.exports = { registerLocalUser, mapRegisterError };
