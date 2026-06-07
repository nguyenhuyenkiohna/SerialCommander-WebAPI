/** RFC5322-pragmatic — dùng chung auth API + services */
const EMAIL_REGEX =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const MIN_PASSWORD_LENGTH = 6;

function normalizeEmail(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

function isValidEmail(raw) {
  const email = normalizeEmail(raw);
  if (!email || email.length > 254) return false;
  return EMAIL_REGEX.test(email);
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự`,
    };
  }
  return { ok: true };
}

function normalizeOtpCode(code) {
  return String(code ?? "").replace(/\D/g, "").slice(0, 6);
}

function isValidOtpCode(code) {
  return /^\d{6}$/.test(normalizeOtpCode(code));
}

function assertValidEmail(raw) {
  if (!isValidEmail(raw)) {
    const error = new Error("Email không hợp lệ");
    error.status = 400;
    error.code = "AUTH_INVALID_EMAIL";
    throw error;
  }
  return normalizeEmail(raw);
}

module.exports = {
  EMAIL_REGEX,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  isValidEmail,
  validatePassword,
  normalizeOtpCode,
  isValidOtpCode,
  assertValidEmail,
};
