/**
 * Chuẩn hóa JWT_SECRET / JWT_SECRET_KEY và SESSION_SECRET.
 * Production: bắt buộc biến môi trường, không dùng default yếu.
 */

const isProduction = () => process.env.NODE_ENV === "production";

const MIN_SECRET_LEN = 16;

function assertStrongEnough(name, value) {
  if (!value || String(value).length < MIN_SECRET_LEN) {
    throw new Error(
      `${name} must be set and at least ${MIN_SECRET_LEN} characters in production`
    );
  }
}

/**
 * JWT: ưu tiên JWT_SECRET, tương thích JWT_SECRET_KEY (legacy).
 * Dev/test: cho phép fallback cố định để chạy local nhanh.
 */
function getJwtSecret() {
  const s = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;
  if (isProduction()) {
    assertStrongEnough("JWT_SECRET (or JWT_SECRET_KEY)", s);
    return s;
  }
  if (process.env.NODE_ENV === "test") {
    return s || process.env.JWT_SECRET || "test-secret-key";
  }
  return s || "dev-only-jwt-secret-not-for-production";
}

function getSessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (isProduction()) {
    assertStrongEnough("SESSION_SECRET", s);
    return s;
  }
  if (process.env.NODE_ENV === "test") {
    return s || "test-session-secret-key";
  }
  return s || "dev-only-session-secret-not-for-production";
}

/**
 * Gọi ngay sau khi load dotenv, trước khi load route/controller dùng JWT/session.
 */
function assertRequiredSecretsLoaded() {
  getJwtSecret();
  getSessionSecret();
}

module.exports = {
  getJwtSecret,
  getSessionSecret,
  assertRequiredSecretsLoaded,
};
