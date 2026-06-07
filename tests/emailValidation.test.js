require("rootpath")();

const {
  normalizeEmail,
  isValidEmail,
  assertValidEmail,
  validatePassword,
  normalizeOtpCode,
  isValidOtpCode,
} = require("utils/emailValidation");

describe("emailValidation", () => {
  test("normalizeEmail chuẩn hóa lowercase + trim", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });

  test("isValidEmail chấp nhận email hợp lệ động", () => {
    expect(isValidEmail("a.b+c@sub.domain.co")).toBe(true);
  });

  test("isValidEmail từ chối email không hợp lệ", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("@missing.com")).toBe(false);
  });

  test("assertValidEmail ném AUTH_INVALID_EMAIL", () => {
    try {
      assertValidEmail("bad");
      throw new Error("expected throw");
    } catch (e) {
      expect(e.code).toBe("AUTH_INVALID_EMAIL");
      expect(e.message).toBe("Email không hợp lệ");
    }
  });

  test("validatePassword tối thiểu 6 ký tự", () => {
    expect(validatePassword("12345").ok).toBe(false);
    expect(validatePassword("123456").ok).toBe(true);
  });

  test("normalizeOtpCode chỉ giữ số", () => {
    expect(normalizeOtpCode("12a34b56")).toBe("123456");
  });

  test("isValidOtpCode", () => {
    expect(isValidOtpCode("123456")).toBe(true);
    expect(isValidOtpCode("12345")).toBe(false);
  });
});
