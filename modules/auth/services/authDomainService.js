const crypto = require("crypto");
const { Op } = require("sequelize");
const { User, PasswordReset, EmailVerificationCode } = require("../../../models");
const { normalizeEmail } = require("../../../utils/emailValidation");

const OTP_EXP_MINUTES = 15;
const DEFAULT_USED_CODE_RETENTION_DAYS = 7;

function createOtpCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function getTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getLoginIdentifier(body) {
  const email = getTrimmedString(body?.email);
  return email ? normalizeEmail(email) : "";
}

function buildLoginWhere(identifier) {
  return { email: identifier };
}

function isGoogleOnlyAccount(user) {
  return user.provider === "google" || !user.password;
}

function isLocalUnverified(user) {
  return user.provider === "local" && user.isVerified !== true;
}

function createExpiryDate(minutes = OTP_EXP_MINUTES) {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + minutes);
  return expiresAt;
}

function hashOneTimeCode(code) {
  const pepper = process.env.OTP_CODE_PEPPER || "";
  if (process.env.NODE_ENV === "production" && pepper.length < 16) {
    throw new Error("OTP_CODE_PEPPER phải được cấu hình (tối thiểu 16 ký tự) trong production");
  }
  return crypto.createHash("sha256").update(`${String(code)}::${pepper}`).digest("hex");
}

function allowLegacyPlaintextOtp() {
  return String(process.env.ALLOW_LEGACY_PLAINTEXT_OTP || "").toLowerCase() === "true";
}

async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return User.findOne({ where: { email: normalized } });
}

async function upsertEmailVerificationCode(userId, email, verifyCode) {
  const normalizedEmail = normalizeEmail(email);
  await EmailVerificationCode.destroy({ where: { UserId: userId } });
  await EmailVerificationCode.create({
    UserId: userId,
    email: normalizedEmail,
    verifyCode: hashOneTimeCode(verifyCode),
    expiresAt: createExpiryDate(OTP_EXP_MINUTES),
    used: false,
  });
}

async function upsertPasswordResetCode(userId, email, resetCode) {
  const normalizedEmail = normalizeEmail(email);
  await PasswordReset.destroy({ where: { UserId: userId } });
  await PasswordReset.create({
    UserId: userId,
    email: normalizedEmail,
    resetCode: hashOneTimeCode(resetCode),
    expiresAt: createExpiryDate(OTP_EXP_MINUTES),
    used: false,
  });
}

async function findEmailVerificationRecord(userId, code) {
  const hashedCode = hashOneTimeCode(code);
  const hashedRecord = await EmailVerificationCode.findOne({
    where: { UserId: userId, verifyCode: hashedCode, used: false },
    order: [["createdAt", "DESC"]],
  });
  if (hashedRecord) return hashedRecord;
  if (!allowLegacyPlaintextOtp()) return null;
  return EmailVerificationCode.findOne({
    where: { UserId: userId, verifyCode: String(code), used: false },
    order: [["createdAt", "DESC"]],
  });
}

async function findPasswordResetRecord(userId, code) {
  const hashedCode = hashOneTimeCode(code);
  const hashedRecord = await PasswordReset.findOne({
    where: { UserId: userId, resetCode: hashedCode, used: false },
    order: [["createdAt", "DESC"]],
  });
  if (hashedRecord) return hashedRecord;
  if (!allowLegacyPlaintextOtp()) return null;
  return PasswordReset.findOne({
    where: { UserId: userId, resetCode: String(code), used: false },
    order: [["createdAt", "DESC"]],
  });
}

async function cleanupExpiredAuthCodes() {
  const now = new Date();
  const retentionDays = parseInt(process.env.AUTH_CODE_USED_RETENTION_DAYS || String(DEFAULT_USED_CODE_RETENTION_DAYS), 10);
  const safeRetentionDays = Number.isFinite(retentionDays) && retentionDays >= 0
    ? retentionDays
    : DEFAULT_USED_CODE_RETENTION_DAYS;
  const usedCutoff = new Date(now.getTime() - safeRetentionDays * 24 * 60 * 60 * 1000);

  const [deletedExpiredVerification, deletedExpiredReset, deletedUsedVerification, deletedUsedReset] = await Promise.all([
    EmailVerificationCode.destroy({
      where: { expiresAt: { [Op.lt]: now } },
    }),
    PasswordReset.destroy({
      where: { expiresAt: { [Op.lt]: now } },
    }),
    EmailVerificationCode.destroy({
      where: {
        used: true,
        updatedAt: { [Op.lt]: usedCutoff },
      },
    }),
    PasswordReset.destroy({
      where: {
        used: true,
        updatedAt: { [Op.lt]: usedCutoff },
      },
    }),
  ]);
  return {
    deletedExpiredVerification,
    deletedExpiredReset,
    deletedUsedVerification,
    deletedUsedReset,
    retentionDays: safeRetentionDays,
  };
}

module.exports = {
  createOtpCode,
  createExpiryDate,
  hashOneTimeCode,
  getLoginIdentifier,
  buildLoginWhere,
  isGoogleOnlyAccount,
  isLocalUnverified,
  findUserByEmail,
  upsertEmailVerificationCode,
  upsertPasswordResetCode,
  findEmailVerificationRecord,
  findPasswordResetRecord,
  cleanupExpiredAuthCodes,
};
