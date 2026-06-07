const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { User } = require("../../models");
const passport = require("../../configs/passport");
const googleOAuthEnabled = passport.googleOAuthEnabled;
const getGoogleOAuthConfig = require("../../configs/googleOAuth");
const jwtConfig = require("../../configs/jwt");
const { getJwtSecret } = require("../../configs/envSecrets");
const { sendError, sendSuccess } = require("../../kernels/middlewares/errorHandler");
const {
  getLoginIdentifier,
  buildLoginWhere,
  isGoogleOnlyAccount,
  isLocalUnverified,
} = require("./services/authDomainService");
// isLocalUnverified: tài khoản chưa verify coi như không tồn tại khi login
const { registerLocalUser, mapRegisterError } = require("./services/authRegisterService");
const {
  verifyEmailCode,
  resendVerificationCode,
  requestPasswordReset,
  verifyPasswordResetCode,
  resetPasswordWithCode,
} = require("./services/authFlowService");
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, username: user.username || user.email, role: user.role },
    getJwtSecret(),
    { expiresIn: jwtConfig.ttl }
  );
};

const sendServiceErrorOrInternal = (res, error, fallbackCode, fallbackLogLabel) => {
  if (error.status && error.code) {
    return sendError(res, error.status, error.message, error.code);
  }
  console.error(`${fallbackLogLabel}:`, error);
  return sendError(res, 500, "Lỗi server. Vui lòng thử lại sau.", fallbackCode);
};

exports.login = async (req, res) => {
  const { password } = req.body;
  const identifier = getLoginIdentifier(req.body);
  if (!identifier || !password) {
    return sendError(res, 400, "Email và mật khẩu là bắt buộc.", "AUTH_INVALID_INPUT");
  }

  try {
    const where = buildLoginWhere(identifier);
    const user = await User.findOne({ where });
    if (!user || isLocalUnverified(user)) {
      return sendError(res, 401, "Sai email hoặc mật khẩu", "AUTH_INVALID_CREDENTIALS");
    }

    if (isGoogleOnlyAccount(user)) {
      return sendError(res, 401, "Tài khoản này đăng nhập bằng Google. Vui lòng sử dụng đăng nhập Google.", "AUTH_GOOGLE_ACCOUNT");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return sendError(res, 401, "Sai email hoặc mật khẩu", "AUTH_INVALID_CREDENTIALS");
    }

    const token = generateToken(user);
    return sendSuccess(res, 200, "Đăng nhập thành công", { token });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, "Lỗi server. Vui lòng thử lại sau.", "AUTH_LOGIN_FAILED");
  }
};

exports.register = async (req, res) => {
  const { password, email, username } = req.body;
  try {
    const result = await registerLocalUser({ password, email, username });

    const payload = {
      requireEmailVerification: true,
      email: result.email,
      emailSent: result.emailSent,
      pendingOnly: true,
    };
    if (result.devOtp && process.env.NODE_ENV !== "production") {
      payload.devOtp = result.devOtp;
      return sendSuccess(
        res,
        201,
        `Đã gửi mã xác thực (dev: ${result.devOtp}). Tài khoản chỉ được tạo sau khi nhập OTP đúng.`,
        payload
      );
    }
    return sendSuccess(
      res,
      201,
      result.emailSent
        ? "Đã gửi mã xác thực đến email. Nhập mã OTP để hoàn tất đăng ký — tài khoản chưa được lưu cho đến khi xác thực thành công."
        : "Chưa gửi được email xác thực. Dùng «Gửi lại mã» hoặc cấu hình GMAIL_* trên server.",
      payload
    );
  } catch (error) {
    const mapped = mapRegisterError(error);
    if (mapped.status >= 500) {
      console.error("Register error:", error);
      if (error.parent?.sqlMessage) console.error("SQL:", error.parent.sqlMessage);
    }
    return sendError(res, mapped.status, mapped.message, mapped.code);
  }
};

// Verify email code after register
exports.verifyEmail = async (req, res) => {
  const { email, code, username } = req.body;
  if (!email || !code) {
    return sendError(res, 400, "Email và mã xác thực là bắt buộc", "AUTH_INVALID_INPUT");
  }

  try {
    const result = await verifyEmailCode(email, code, username);
    if (result.alreadyVerified) {
      return sendSuccess(res, 200, "OK", { alreadyVerified: true });
    }
    return sendSuccess(res, 200, "OK", { verified: true });
  } catch (error) {
    return sendServiceErrorOrInternal(res, error, "AUTH_VERIFY_EMAIL_FAILED", "Verify email error");
  }
};

// Resend email verification code for local account
exports.resendVerificationCode = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return sendError(res, 400, "Email là bắt buộc", "AUTH_INVALID_INPUT");
  }

  try {
    const result = await resendVerificationCode(email);
    if (result.ignored) {
      return sendError(
        res,
        400,
        "Chưa có mã xác thực được gửi đến email này. Vui lòng đăng ký lại.",
        "AUTH_NO_PENDING_REGISTRATION"
      );
    }
    if (result.alreadyVerified) {
      return sendSuccess(res, 200, "OK", { alreadyVerified: true });
    }
    if (result.devOtp && process.env.NODE_ENV !== "production") {
      return sendSuccess(
        res,
        200,
        `Chế độ dev: mã xác thực là ${result.devOtp} (xem log server). Cấu hình GMAIL_* để gửi email thật.`,
        { devOtp: result.devOtp, emailSent: false }
      );
    }
    return sendSuccess(res, 200, "Đã gửi lại mã xác thực email.", { emailSent: true });
  } catch (error) {
    return sendServiceErrorOrInternal(res, error, "AUTH_RESEND_OTP_FAILED", "Resend verification code error");
  }
};

exports.googleOAuthStatus = (req, res) => {
  return sendSuccess(res, 200, "OK", {
    enabled: googleOAuthEnabled,
    callbackURL: googleOAuthEnabled ? getGoogleOAuthConfig().callbackURL : undefined,
  });
};

// Google OAuth - initiate authentication
exports.googleAuth = (req, res, next) => {
  if (!googleOAuthEnabled) {
    return res.redirect(
      `${FRONTEND_URL}/login?error=oauth_not_configured`
    );
  }
  passport.authenticate("google", {
    scope: ["profile", "email"],
    state: true,
  })(req, res, next);
};

// Google OAuth - handle callback
exports.googleCallback = (req, res, next) => {
  if (!googleOAuthEnabled) {
    return res.redirect(`${FRONTEND_URL}/login?error=oauth_not_configured`);
  }
  passport.authenticate("google", { session: true }, (err, user, info) => {
    if (err) {
      console.error("Google OAuth error:", err);
      return res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
    }

    if (!user) {
      const errorCode = info?.message === "EMAIL_LINKED_TO_LOCAL"
        ? "email_linked_to_local"
        : "oauth_failed";
      return res.redirect(`${FRONTEND_URL}/login?error=${errorCode}`);
    }

    // Generate JWT token
    const token = generateToken(user);
    const setupProfile = user._isNewOAuthUser ? "&setupProfile=1" : "";

    // Không đưa JWT qua query string (dễ rò qua logs/referer). Dùng URL fragment (#) để FE đọc,
    // fragment không được gửi lên server trong HTTP request.
    res.redirect(`${FRONTEND_URL}/login#token=${token}${setupProfile}`);
  })(req, res, next);
};

// Forgot Password - Request reset code
exports.requestPasswordReset = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return sendError(res, 400, "Email là bắt buộc", "AUTH_INVALID_INPUT");
  }

  try {
    const result = await requestPasswordReset(email);
    if (result.notFound) {
      return sendError(
        res,
        404,
        "Email không tồn tại trong hệ thống",
        "AUTH_EMAIL_NOT_FOUND"
      );
    }
    if (result.googleAccount) {
      return sendError(
        res,
        400,
        "Tài khoản này đăng nhập bằng Google. Vui lòng sử dụng đăng nhập Google.",
        "AUTH_GOOGLE_ACCOUNT"
      );
    }
    if (result.emailSendFailed) {
      return sendError(
        res,
        503,
        "Không gửi được email đặt lại mật khẩu. Thử lại sau hoặc liên hệ quản trị.",
        "AUTH_EMAIL_SEND_FAILED"
      );
    }
    if (result.devOtp && process.env.NODE_ENV !== "production") {
      return sendSuccess(res, 200, "OK", { devOtp: result.devOtp, emailSent: false });
    }
    return sendSuccess(res, 200, "OK", { emailSent: true });
  } catch (error) {
    return sendServiceErrorOrInternal(res, error, "AUTH_REQUEST_RESET_FAILED", "Request password reset error");
  }
};

// Verify reset code
exports.verifyResetCode = async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return sendError(res, 400, "Email và mã reset là bắt buộc", "AUTH_INVALID_INPUT");
  }

  try {
    await verifyPasswordResetCode(email, code);
    return sendSuccess(res, 200, "Mã reset hợp lệ", { valid: true });
  } catch (error) {
    return sendServiceErrorOrInternal(res, error, "AUTH_VERIFY_RESET_FAILED", "Verify reset code error");
  }
};

// Reset password với code
exports.resetPassword = async (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    return sendError(res, 400, "Email, mã reset và mật khẩu mới là bắt buộc", "AUTH_INVALID_INPUT");
  }

  const { validatePassword } = require("../../utils/emailValidation");
  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.ok) {
    return sendError(res, 400, passwordCheck.message, "AUTH_PASSWORD_WEAK");
  }

  try {
    await resetPasswordWithCode(email, code, newPassword);
    return sendSuccess(res, 200, "Đặt lại mật khẩu thành công. Vui lòng đăng nhập với mật khẩu mới.");
  } catch (error) {
    return sendServiceErrorOrInternal(res, error, "AUTH_RESET_PASSWORD_FAILED", "Reset password error");
  }
};
