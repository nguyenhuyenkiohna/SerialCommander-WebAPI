const express = require("express");
const router = express.Router();
const authController = require("modules/auth/authController");
const { createSimpleRateLimit } = require("../kernels/middlewares/simpleRateLimit");
const { validateAuth } = require("../kernels/validations");
const {
  registerValidators,
  verifyEmailValidators,
  resendVerificationValidators,
  loginValidators,
  forgotPasswordValidators,
  verifyResetValidators,
  resetPasswordValidators,
} = require("../kernels/validations/authValidators");

const authLoginRateLimit = createSimpleRateLimit({ windowMs: 60 * 1000, maxRequests: 10 });
const authRegisterRateLimit = createSimpleRateLimit({ windowMs: 60 * 1000, maxRequests: 5 });
const authOtpRateLimit = createSimpleRateLimit({ windowMs: 60 * 1000, maxRequests: 8 });
const authResetRateLimit = createSimpleRateLimit({ windowMs: 60 * 1000, maxRequests: 6 });

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Đăng nhập người dùng
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Đăng nhập thành công
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginSuccessResponse'
 *       401:
 *         description: Sai email hoặc mật khẩu
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/login", authLoginRateLimit, validateAuth(loginValidators), authController.login);

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Đăng ký tài khoản mới
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: Đăng ký thành công
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RegisterSuccessResponse'
 *       400:
 *         description: Email hoặc username đã tồn tại
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/register", authRegisterRateLimit, validateAuth(registerValidators), authController.register);

/**
 * @swagger
 * /api/auth/verify-email:
 *   post:
 *     summary: Xác thực email bằng mã OTP
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Xác thực thành công hoặc đã xác thực trước đó
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageSuccessResponse'
 *       400:
 *         description: Mã không hợp lệ, hết hạn, hoặc input sai
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/verify-email", authOtpRateLimit, validateAuth(verifyEmailValidators), authController.verifyEmail);

/**
 * @swagger
 * /api/auth/resend-verification-code:
 *   post:
 *     summary: Gửi lại mã xác thực email
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Gửi mã thành công
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageSuccessResponse'
 *       400:
 *         description: Input không hợp lệ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/resend-verification-code",
  authOtpRateLimit,
  validateAuth(resendVerificationValidators),
  authController.resendVerificationCode
);

/**
 * @swagger
 * /api/auth/google/status:
 *   get:
 *     summary: Trạng thái cấu hình Google OAuth
 *     tags: [Authentication]
 */
router.get("/google/status", authController.googleOAuthStatus);

/**
 * @swagger
 * /api/auth/google:
 *   get:
 *     summary: Đăng nhập bằng Google OAuth
 *     tags: [Authentication]
 *     responses:
 *       302:
 *         description: Redirect đến Google OAuth
 */
router.get("/google", authController.googleAuth);

/**
 * @swagger
 * /api/auth/google/callback:
 *   get:
 *     summary: Google OAuth callback
 *     tags: [Authentication]
 *     responses:
 *       302:
 *         description: Redirect về frontend với token
 */
router.get("/google/callback", authController.googleCallback);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Yêu cầu mã đặt lại mật khẩu
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email đã được gửi (nếu email tồn tại)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageSuccessResponse'
 *       400:
 *         description: Input không hợp lệ hoặc tài khoản Google
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/forgot-password",
  authOtpRateLimit,
  validateAuth(forgotPasswordValidators),
  authController.requestPasswordReset
);

/**
 * @swagger
 * /api/auth/verify-reset-code:
 *   post:
 *     summary: Xác thực mã đặt lại mật khẩu
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - code
 *             properties:
 *               email:
 *                 type: string
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Mã hợp lệ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VerifyResetCodeSuccessResponse'
 *       400:
 *         description: Mã không hợp lệ hoặc đã hết hạn
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/verify-reset-code",
  authOtpRateLimit,
  validateAuth(verifyResetValidators),
  authController.verifyResetCode
);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Đặt lại mật khẩu với mã xác thực
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - code
 *               - newPassword
 *             properties:
 *               email:
 *                 type: string
 *               code:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Đặt lại mật khẩu thành công
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageSuccessResponse'
 *       400:
 *         description: Mã không hợp lệ hoặc mật khẩu không đủ dài
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/reset-password",
  authResetRateLimit,
  validateAuth(resetPasswordValidators),
  authController.resetPassword
);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Làm mới access token dùng refresh token (HttpOnly cookie sc_refresh_token)
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Access token mới đã được gắn vào cookie sc_auth_token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageSuccessResponse'
 *       401:
 *         description: Refresh token thiếu, không hợp lệ, hoặc đã hết hạn
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/refresh", authController.refresh);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Đăng xuất — xóa HttpOnly cookie sc_auth_token và sc_refresh_token
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Đăng xuất thành công
 */
router.post("/logout", authController.logout);

module.exports = router;
