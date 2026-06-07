const USERNAME_MIN = 2;
const USERNAME_MAX = 50;
/** Chữ, số, khoảng trắng, gạch dưới, gạch ngang, dấu chấm — hỗ trợ tiếng Việt có dấu. */
const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{0,49}$/u;

function normalizeUsername(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ");
}

function validateUsername(raw) {
  const value = normalizeUsername(raw);
  if (!value) {
    return { ok: false, message: "Tên hiển thị là bắt buộc" };
  }
  if (value.length < USERNAME_MIN) {
    return { ok: false, message: `Tên hiển thị phải có ít nhất ${USERNAME_MIN} ký tự` };
  }
  if (value.length > USERNAME_MAX) {
    return { ok: false, message: `Tên hiển thị tối đa ${USERNAME_MAX} ký tự` };
  }
  if (!USERNAME_RE.test(value)) {
    return {
      ok: false,
      message: "Tên hiển thị chỉ gồm chữ, số, khoảng trắng và _ . -",
    };
  }
  return { ok: true, value };
}

module.exports = {
  USERNAME_MIN,
  USERNAME_MAX,
  normalizeUsername,
  validateUsername,
};
