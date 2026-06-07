const bcrypt = require("bcryptjs");
const { User, PendingRegistration, EmailVerificationCode, PasswordReset } = require("../../../models");
const { hashOneTimeCode, createExpiryDate } = require("./authDomainService");
const { normalizeEmail } = require("../../../utils/emailValidation");
const { validateUsername } = require("../../../utils/usernameValidation");

async function removeLegacyUnverifiedLocalUser(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  const user = await User.findOne({
    where: { email: normalized, provider: "local", isVerified: false },
  });
  if (!user) return;

  await Promise.all([
    EmailVerificationCode.destroy({ where: { UserId: user.id } }),
    PasswordReset.destroy({ where: { UserId: user.id } }),
  ]);
  await user.destroy();
}

async function upsertPendingRegistration(email, plainPassword, verifyCode) {
  const normalized = normalizeEmail(email);
  const hashedPassword = await bcrypt.hash(plainPassword, 10);
  const payload = {
    password: hashedPassword,
    verifyCode: hashOneTimeCode(verifyCode),
    expiresAt: createExpiryDate(),
  };

  const existing = await PendingRegistration.findOne({ where: { email: normalized } });
  if (existing) {
    await existing.update(payload);
    return existing;
  }
  return PendingRegistration.create({ email: normalized, ...payload });
}

async function findPendingByEmail(email) {
  const normalized = normalizeEmail(email);
  const row = await PendingRegistration.findOne({ where: { email: normalized } });
  if (!row) return null;
  if (new Date() > row.expiresAt) {
    await row.destroy();
    return null;
  }
  return row;
}

function pendingCodeMatches(row, code) {
  const hashed = hashOneTimeCode(code);
  if (row.verifyCode === hashed) return true;
  if (String(process.env.ALLOW_LEGACY_PLAINTEXT_OTP || "").toLowerCase() === "true") {
    return row.verifyCode === String(code);
  }
  return false;
}

async function findPendingByEmailAndCode(email, code) {
  const row = await findPendingByEmail(email);
  if (!row || !pendingCodeMatches(row, code)) return null;
  return row;
}

async function refreshPendingVerificationCode(email, verifyCode) {
  const normalized = normalizeEmail(email);
  const row = await PendingRegistration.findOne({ where: { email: normalized } });
  if (!row) return null;
  await row.update({
    verifyCode: hashOneTimeCode(verifyCode),
    expiresAt: createExpiryDate(),
  });
  return row;
}

async function pickUniqueUsername(email) {
  const localPart = email.split("@")[0] || "user";
  const base = localPart.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40) || "user";
  let candidate = base;
  let suffix = 0;
  while (await User.findOne({ where: { username: candidate } })) {
    suffix += 1;
    candidate = `${base}${suffix}`.slice(0, 50);
  }
  return candidate;
}

async function resolveRegistrationUsername(email, preferredUsername) {
  if (preferredUsername) {
    const check = validateUsername(preferredUsername);
    if (!check.ok) {
      const err = new Error(check.message);
      err.status = 400;
      err.code = "AUTH_USERNAME_INVALID";
      throw err;
    }
    const taken = await User.findOne({ where: { username: check.value } });
    if (taken) {
      const err = new Error("Tên hiển thị đã được sử dụng");
      err.status = 409;
      err.code = "AUTH_USERNAME_TAKEN";
      throw err;
    }
    return check.value;
  }
  return pickUniqueUsername(email);
}

async function activatePendingRegistration(pending, preferredUsername) {
  const email = normalizeEmail(pending.email);
  const verified = await User.findOne({
    where: { email, provider: "local", isVerified: true },
  });
  if (verified) {
    await pending.destroy();
    return verified;
  }

  await removeLegacyUnverifiedLocalUser(email);

  const username = await resolveRegistrationUsername(email, preferredUsername);
  const user = await User.create({
    email,
    username,
    password: pending.password,
    provider: "local",
    isVerified: true,
    role: "user",
  });

  await pending.destroy();
  return user;
}

module.exports = {
  removeLegacyUnverifiedLocalUser,
  resolveRegistrationUsername,
  upsertPendingRegistration,
  findPendingByEmail,
  findPendingByEmailAndCode,
  refreshPendingVerificationCode,
  activatePendingRegistration,
};
