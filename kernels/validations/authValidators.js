const { body } = require("express-validator");
const {
  normalizeEmail,
  isValidEmail,
  MIN_PASSWORD_LENGTH,
  normalizeOtpCode,
  isValidOtpCode,
} = require("../../utils/emailValidation");

function emailField(fieldName = "email") {
  return body(fieldName)
    .trim()
    .notEmpty()
    .withMessage("Email là bắt buộc")
    .bail()
    .customSanitizer((value) => normalizeEmail(value))
    .custom((value) => {
      if (!isValidEmail(value)) {
        throw new Error("Email không hợp lệ");
      }
      return true;
    });
}

function passwordField(fieldName = "password", { required = true } = {}) {
  let chain = body(fieldName);
  if (required) {
    chain = chain.notEmpty().withMessage("Mật khẩu là bắt buộc").bail();
  }
  return chain
    .isString()
    .withMessage("Mật khẩu không hợp lệ")
    .bail()
    .isLength({ min: MIN_PASSWORD_LENGTH })
    .withMessage(`Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự`);
}

function otpCodeField(fieldName = "code") {
  return body(fieldName)
    .trim()
    .notEmpty()
    .withMessage("Mã xác thực là bắt buộc")
    .bail()
    .customSanitizer((value) => normalizeOtpCode(value))
    .custom((value) => {
      if (!isValidOtpCode(value)) {
        throw new Error("Mã xác thực phải gồm 6 chữ số");
      }
      return true;
    });
}

const registerValidators = [emailField("email"), passwordField("password")];

const verifyEmailValidators = [emailField("email"), otpCodeField("code")];

const resendVerificationValidators = [emailField("email")];

const loginValidators = [emailField("email"), passwordField("password")];

const forgotPasswordValidators = [emailField("email")];

const verifyResetValidators = [emailField("email"), otpCodeField("code")];

const resetPasswordValidators = [
  emailField("email"),
  otpCodeField("code"),
  passwordField("newPassword"),
];

module.exports = {
  registerValidators,
  verifyEmailValidators,
  resendVerificationValidators,
  loginValidators,
  forgotPasswordValidators,
  verifyResetValidators,
  resetPasswordValidators,
};
