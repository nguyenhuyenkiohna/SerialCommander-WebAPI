const bcrypt = require("bcryptjs");
const { User, PasswordReset } = require("../../../models");
const { sendPasswordResetEmail, sendEmailVerificationCodeEmail } = require("../../../utils/emailService");
const {
  createOtpCode,
  findUserByEmail,
  upsertEmailVerificationCode,
  upsertPasswordResetCode,
  findEmailVerificationRecord,
  findPasswordResetRecord,
  isGoogleOnlyAccount,
} = require("./authDomainService");
const {
  findPendingByEmail,
  findPendingByEmailAndCode,
  refreshPendingVerificationCode,
  activatePendingRegistration,
} = require("./pendingRegistrationService");
const {
  assertValidEmail,
  normalizeOtpCode,
} = require("../../../utils/emailValidation");

function createAppError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

const OTP_INVALID_MESSAGE =
  "Mã xác thực không đúng hoặc đã hết hạn. Vui lòng kiểm tra lại email hoặc yêu cầu mã mới.";
const RESET_INVALID_MESSAGE =
  "Mã xác nhận không đúng hoặc đã hết hạn. Vui lòng kiểm tra lại email hoặc yêu cầu mã mới.";

async function verifyEmailCode(email, code, preferredUsername) {
  const normalizedEmail = assertValidEmail(email);
  const normalizedCode = normalizeOtpCode(code);
  if (normalizedCode.length !== 6) {
    throw createAppError(400, "AUTH_OTP_INVALID", OTP_INVALID_MESSAGE);
  }

  const verifiedUser = await User.findOne({
    where: { email: normalizedEmail, provider: "local", isVerified: true },
  });
  if (verifiedUser) {
    return { alreadyVerified: true };
  }

  const pending = await findPendingByEmailAndCode(normalizedEmail, normalizedCode);
  if (pending) {
    await activatePendingRegistration(pending, preferredUsername);
    return { success: true, created: true };
  }

  const legacyUser = await findUserByEmail(normalizedEmail);
  if (legacyUser && legacyUser.provider === "local" && legacyUser.isVerified !== true) {
    const verifyRecord = await findEmailVerificationRecord(legacyUser.id, normalizedCode);
    if (!verifyRecord) {
      throw createAppError(400, "AUTH_OTP_INVALID", OTP_INVALID_MESSAGE);
    }
    if (new Date() > verifyRecord.expiresAt) {
      throw createAppError(400, "AUTH_OTP_EXPIRED", OTP_INVALID_MESSAGE);
    }
    await legacyUser.update({ isVerified: true });
    await verifyRecord.destroy();
    return { success: true, created: false };
  }

  throw createAppError(400, "AUTH_OTP_INVALID", OTP_INVALID_MESSAGE);
}

async function resendVerificationCode(email) {
  const normalizedEmail = assertValidEmail(email);

  const verifiedUser = await User.findOne({
    where: { email: normalizedEmail, provider: "local", isVerified: true },
  });
  if (verifiedUser) {
    return { alreadyVerified: true };
  }

  const pending = await findPendingByEmail(normalizedEmail);
  if (pending) {
    const verifyCode = createOtpCode();
    await refreshPendingVerificationCode(normalizedEmail, verifyCode);
    const mailResult = await sendEmailVerificationCodeEmail(normalizedEmail, verifyCode);
    return {
      sent: true,
      emailSent: !mailResult.devLogged,
      devOtp:
        mailResult.devLogged && process.env.NODE_ENV !== "production" ? verifyCode : undefined,
    };
  }

  const legacyUser = await findUserByEmail(normalizedEmail);
  if (legacyUser && legacyUser.provider === "local" && legacyUser.isVerified !== true) {
    const verifyCode = createOtpCode();
    await upsertEmailVerificationCode(legacyUser.id, normalizedEmail, verifyCode);
    const mailResult = await sendEmailVerificationCodeEmail(normalizedEmail, verifyCode);
    return {
      sent: true,
      emailSent: !mailResult.devLogged,
      devOtp:
        mailResult.devLogged && process.env.NODE_ENV !== "production" ? verifyCode : undefined,
    };
  }

  return { ignored: true };
}

async function requestPasswordReset(email) {
  const normalizedEmail = assertValidEmail(email);
  const user = await findUserByEmail(normalizedEmail);
  if (!user || user.isVerified !== true) {
    return { notFound: true };
  }
  if (isGoogleOnlyAccount(user)) {
    return { googleAccount: true };
  }

  const resetCode = createOtpCode();
  await upsertPasswordResetCode(user.id, normalizedEmail, resetCode);
  try {
    const mailResult = await sendPasswordResetEmail(normalizedEmail, resetCode);
    return {
      sent: true,
      emailSent: !mailResult.devLogged,
      devOtp:
        mailResult.devLogged && process.env.NODE_ENV !== "production" ? resetCode : undefined,
    };
  } catch (_error) {
    return { emailSendFailed: true };
  }
}

async function verifyPasswordResetCode(email, code) {
  const normalizedEmail = assertValidEmail(email);
  const normalizedCode = normalizeOtpCode(code);
  if (normalizedCode.length !== 6) {
    throw createAppError(400, "AUTH_RESET_CODE_INVALID", RESET_INVALID_MESSAGE);
  }

  const user = await findUserByEmail(normalizedEmail);
  if (!user || user.isVerified !== true) {
    throw createAppError(400, "AUTH_RESET_CODE_INVALID", RESET_INVALID_MESSAGE);
  }
  const resetRecord = await findPasswordResetRecord(user.id, normalizedCode);
  if (!resetRecord) {
    throw createAppError(400, "AUTH_RESET_CODE_INVALID", RESET_INVALID_MESSAGE);
  }
  if (new Date() > resetRecord.expiresAt) {
    throw createAppError(400, "AUTH_RESET_CODE_EXPIRED", RESET_INVALID_MESSAGE);
  }
  return { valid: true };
}

async function resetPasswordWithCode(email, code, newPassword) {
  const normalizedEmail = assertValidEmail(email);
  const normalizedCode = normalizeOtpCode(code);
  const user = await findUserByEmail(normalizedEmail);
  if (!user || user.isVerified !== true) {
    throw createAppError(400, "AUTH_RESET_CODE_INVALID", RESET_INVALID_MESSAGE);
  }
  const resetRecord = await findPasswordResetRecord(user.id, normalizedCode);
  if (!resetRecord) {
    throw createAppError(400, "AUTH_RESET_CODE_INVALID", RESET_INVALID_MESSAGE);
  }
  if (new Date() > resetRecord.expiresAt) {
    throw createAppError(400, "AUTH_RESET_CODE_EXPIRED", RESET_INVALID_MESSAGE);
  }

  const [affectedCount] = await PasswordReset.update(
    { used: true },
    { where: { id: resetRecord.id, used: false } }
  );
  if (affectedCount === 0) {
    throw createAppError(400, "AUTH_RESET_CODE_INVALID", RESET_INVALID_MESSAGE);
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await user.update({ password: hashedPassword });
  await PasswordReset.destroy({ where: { UserId: user.id, used: true } });
  return { success: true };
}

module.exports = {
  verifyEmailCode,
  resendVerificationCode,
  requestPasswordReset,
  verifyPasswordResetCode,
  resetPasswordWithCode,
};
