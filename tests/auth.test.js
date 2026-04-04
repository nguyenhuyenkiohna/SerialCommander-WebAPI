/**
 * Unit Tests - Auth Flow (Login, Register, Password Reset)
 *
 * Chạy: npm test -- --testPathPattern=auth.test.js
 *
 * Các test này dùng mock cho database để không cần kết nối MySQL thật.
 */

// Load test env trước tiên
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-key";
process.env.FRONTEND_URL = "http://localhost:5173";

require("rootpath")();

// Mock Sequelize models trước khi require authController
// Dùng tên module theo rootpath (không dùng relative path)
jest.mock("models", () => {
  const mockUser = {
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  };
  const mockPasswordReset = {
    findOne: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
    update: jest.fn(),
  };
  return {
    User: mockUser,
    PasswordReset: mockPasswordReset,
  };
});

jest.mock("utils/emailService", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
  sendEmailVerificationCodeEmail: jest.fn().mockResolvedValue(true),
}));

// Mock passport để tránh lỗi "OAuth2Strategy requires clientID"
jest.mock("configs/passport", () => {
  const passport = require("passport");
  return passport;
});

const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User, PasswordReset } = require("models");

// Setup minimal express app for testing
const authRoutes = require("routes/auth");
const app = express();
app.use(express.json());

// Mock passport session for tests
app.use((req, res, next) => {
  req.isAuthenticated = () => false;
  next();
});

app.use("/api/auth", authRoutes);

// ─── Helper ─────────────────────────────────────────────────────────────────

const makeHashedPassword = async (plainText) => bcrypt.hash(plainText, 10);

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── LOGIN TESTS ────────────────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  test("✅ Đăng nhập thành công với username/password đúng", async () => {
    const hashedPassword = await makeHashedPassword("correctpass");
    User.findOne.mockResolvedValue({
      id: 1,
      username: "testuser",
      password: hashedPassword,
      role: "user",
      provider: "local",
      isVerified: true,
    });

    const res = await request(app).post("/api/auth/login").send({
      username: "testuser",
      password: "correctpass",
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");

    // Verify token chứa đúng thông tin
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.id).toBe(1);
    expect(decoded.username).toBe("testuser");
  });

  test("❌ Đăng nhập thất bại khi sai mật khẩu", async () => {
    const hashedPassword = await makeHashedPassword("correctpass");
    User.findOne.mockResolvedValue({
      id: 1,
      username: "testuser",
      password: hashedPassword,
      provider: "local",
      isVerified: true,
    });

    const res = await request(app).post("/api/auth/login").send({
      username: "testuser",
      password: "wrongpass",
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Sai tài khoản hoặc mật khẩu/i);
  });

  test("❌ Đăng nhập thất bại khi username không tồn tại", async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/login").send({
      username: "nonexistent",
      password: "somepass",
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toBeDefined();
  });

  test("❌ Trả về 400 khi thiếu username hoặc password", async () => {
    const res = await request(app).post("/api/auth/login").send({
      username: "testuser",
      // password missing
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/bắt buộc/i);
  });

  test("❌ Tài khoản Google không thể login bằng password", async () => {
    User.findOne.mockResolvedValue({
      id: 2,
      username: "googleuser",
      password: null,
      provider: "google",
    });

    const res = await request(app).post("/api/auth/login").send({
      username: "googleuser",
      password: "anypass",
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Google/i);
  });

  test("❌ Tài khoản local chưa xác thực email thì không thể login", async () => {
    const hashedPassword = await makeHashedPassword("correctpass");
    User.findOne.mockResolvedValue({
      id: 3,
      username: "needverify",
      password: hashedPassword,
      provider: "local",
      isVerified: false,
    });

    const res = await request(app).post("/api/auth/login").send({
      username: "needverify",
      password: "correctpass",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/xác thực email/i);
  });
});

// ─── REGISTER TESTS ─────────────────────────────────────────────────────────

describe("POST /api/auth/register", () => {
  test("✅ Đăng ký thành công với đầy đủ thông tin", async () => {
    User.findOne.mockResolvedValue(null); // Email chưa tồn tại
    User.create.mockResolvedValue({
      id: 3,
      username: "newuser",
      email: "new@test.com",
      role: "user",
    });

    const res = await request(app).post("/api/auth/register").send({
      username: "newuser",
      email: "new@test.com",
      password: "password123",
    });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/thành công/i);
  });

  test("❌ Đăng ký thất bại khi email đã tồn tại", async () => {
    User.findOne.mockResolvedValueOnce({
      id: 1,
      email: "existing@test.com",
    }); // Email đã tồn tại

    const res = await request(app).post("/api/auth/register").send({
      username: "anotheruser",
      email: "existing@test.com",
      password: "password123",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
  });

  test("❌ Đăng ký thất bại khi thiếu email", async () => {
    const res = await request(app).post("/api/auth/register").send({
      username: "newuser",
      password: "password123",
      // email missing
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
  });

  test("❌ Đăng ký thất bại khi thiếu password", async () => {
    const res = await request(app).post("/api/auth/register").send({
      username: "newuser",
      email: "test@test.com",
      // password missing
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/mật khẩu/i);
  });

  test("❌ Đăng ký thất bại khi username đã tồn tại", async () => {
    User.findOne
      .mockResolvedValueOnce(null) // email chưa tồn tại
      .mockResolvedValueOnce({ id: 1, username: "existinguser" }); // username đã có

    const res = await request(app).post("/api/auth/register").send({
      username: "existinguser",
      email: "brand@new.com",
      password: "password123",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tên đăng nhập/i);
  });

  test("❌ Xử lý đúng lỗi SequelizeUniqueConstraintError từ DB", async () => {
    User.findOne.mockResolvedValue(null);
    const duplicateError = new Error("ER_DUP_ENTRY");
    duplicateError.name = "SequelizeUniqueConstraintError";
    duplicateError.fields = { email: "email" };
    User.create.mockRejectedValue(duplicateError);

    const res = await request(app).post("/api/auth/register").send({
      username: "user99",
      email: "dup@test.com",
      password: "password123",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
  });
});

// ─── FORGOT PASSWORD TESTS ──────────────────────────────────────────────────

describe("POST /api/auth/forgot-password", () => {
  test("✅ Trả về success dù email không tồn tại (security - không tiết lộ)", async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/forgot-password").send({
      email: "notexist@test.com",
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/nếu email tồn tại/i);
  });

  test("✅ Gửi email thành công khi email hợp lệ", async () => {
    User.findOne.mockResolvedValue({
      id: 1,
      email: "user@test.com",
      provider: "local",
      password: "hashed",
      isVerified: true,
    });
    PasswordReset.destroy.mockResolvedValue(1);
    PasswordReset.create.mockResolvedValue({
      id: 1,
      resetCode: "123456",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const res = await request(app).post("/api/auth/forgot-password").send({
      email: "user@test.com",
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/nếu email tồn tại/i);
  });

  test("❌ Trả về 400 khi thiếu email", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
  });

  test("❌ Tài khoản Google không thể reset password", async () => {
    User.findOne.mockResolvedValue({
      id: 2,
      email: "google@test.com",
      provider: "google",
      password: null,
    });

    const res = await request(app).post("/api/auth/forgot-password").send({
      email: "google@test.com",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Google/i);
  });
});

// ─── VERIFY RESET CODE TESTS ─────────────────────────────────────────────────

describe("POST /api/auth/verify-reset-code", () => {
  test("✅ Mã reset hợp lệ", async () => {
    User.findOne.mockResolvedValue({ id: 1, email: "user@test.com" });
    PasswordReset.findOne.mockResolvedValue({
      id: 1,
      resetCode: "123456",
      used: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 phút nữa
    });

    const res = await request(app).post("/api/auth/verify-reset-code").send({
      email: "user@test.com",
      code: "123456",
    });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  test("❌ Mã reset đã hết hạn", async () => {
    User.findOne.mockResolvedValue({ id: 1, email: "user@test.com" });
    PasswordReset.findOne.mockResolvedValue({
      id: 1,
      resetCode: "123456",
      used: false,
      expiresAt: new Date(Date.now() - 1000), // đã hết hạn
    });

    const res = await request(app).post("/api/auth/verify-reset-code").send({
      email: "user@test.com",
      code: "123456",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/hết hạn/i);
  });

  test("❌ Mã reset không đúng", async () => {
    User.findOne.mockResolvedValue({ id: 1, email: "user@test.com" });
    PasswordReset.findOne.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/verify-reset-code").send({
      email: "user@test.com",
      code: "000000",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/không hợp lệ/i);
  });
});

// ─── RESET PASSWORD TESTS ────────────────────────────────────────────────────

describe("POST /api/auth/reset-password", () => {
  test("✅ Reset password thành công", async () => {
    const mockUser = {
      id: 1,
      email: "user@test.com",
      update: jest.fn().mockResolvedValue(true),
    };
    const mockResetRecord = {
      id: 1,
      resetCode: "123456",
      used: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      update: jest.fn().mockResolvedValue(true),
    };

    User.findOne.mockResolvedValue(mockUser);
    PasswordReset.findOne.mockResolvedValue(mockResetRecord);
    PasswordReset.destroy.mockResolvedValue(1);

    const res = await request(app).post("/api/auth/reset-password").send({
      email: "user@test.com",
      code: "123456",
      newPassword: "newpassword123",
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/thành công/i);
    expect(mockUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ password: expect.any(String) })
    );
    expect(mockResetRecord.update).toHaveBeenCalledWith({ used: true });
  });

  test("❌ Mật khẩu mới quá ngắn (< 6 ký tự)", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({
      email: "user@test.com",
      code: "123456",
      newPassword: "abc",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/6 ký tự/i);
  });

  test("❌ Thiếu các trường bắt buộc", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({
      email: "user@test.com",
      // code và newPassword missing
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBeDefined();
  });
});

// ─── VERIFY EMAIL TESTS ─────────────────────────────────────────────────────

describe("POST /api/auth/verify-email", () => {
  test("✅ Xác thực email thành công", async () => {
    const mockUser = {
      id: 10,
      email: "verify@test.com",
      provider: "local",
      isVerified: false,
      update: jest.fn().mockResolvedValue(true),
    };
    const verifyRecord = {
      id: 1,
      resetCode: "123456",
      used: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      update: jest.fn().mockResolvedValue(true),
    };

    User.findOne.mockResolvedValue(mockUser);
    PasswordReset.findOne.mockResolvedValue(verifyRecord);
    PasswordReset.destroy.mockResolvedValue(1);

    const res = await request(app).post("/api/auth/verify-email").send({
      email: "verify@test.com",
      code: "123456",
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/thành công/i);
    expect(mockUser.update).toHaveBeenCalledWith({ isVerified: true });
  });

  test("❌ Mã xác thực email sai hoặc đã dùng", async () => {
    User.findOne.mockResolvedValue({
      id: 10,
      email: "verify@test.com",
      provider: "local",
      isVerified: false,
    });
    PasswordReset.findOne.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/verify-email").send({
      email: "verify@test.com",
      code: "000000",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/không hợp lệ/i);
  });
});
