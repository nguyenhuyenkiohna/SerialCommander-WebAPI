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
process.env.ALLOW_LEGACY_PLAINTEXT_OTP = "true";
process.env.OTP_CODE_PEPPER = "test-otp-pepper-for-jest-ok";

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
    update: jest.fn().mockResolvedValue([1]),
  };
  const mockEmailVerificationCode = {
    findOne: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
    update: jest.fn(),
  };
  const mockPendingRegistration = {
    findOne: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
    update: jest.fn(),
  };
  return {
    User: mockUser,
    PasswordReset: mockPasswordReset,
    EmailVerificationCode: mockEmailVerificationCode,
    PendingRegistration: mockPendingRegistration,
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
const { User, PasswordReset, EmailVerificationCode, PendingRegistration } = require("models");

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
const expectErrorContract = (res, code) => {
  expect(res.body).toHaveProperty("error");
  expect(res.body.error).toHaveProperty("code", code);
  expect(typeof res.body.error.message).toBe("string");
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── LOGIN TESTS ────────────────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  test("✅ Đăng nhập thành công với email/password đúng", async () => {
    const hashedPassword = await makeHashedPassword("correctpass");
    User.findOne.mockResolvedValue({
      id: 1,
      email: "test@test.com",
      username: "testuser",
      password: hashedPassword,
      role: "user",
      provider: "local",
      isVerified: true,
    });

    const res = await request(app).post("/api/auth/login").send({
      email: "test@test.com",
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
      email: "test@test.com",
      password: "wrongpass",
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Sai email hoặc mật khẩu/i);
    expectErrorContract(res, "AUTH_INVALID_CREDENTIALS");
  });

  test("❌ Đăng nhập thất bại khi email không tồn tại", async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/login").send({
      email: "missing@test.com",
      password: "somepass",
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toBeDefined();
  });

  test("❌ Trả về 422 khi thiếu password", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: "test@test.com",
      // password missing
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/mật khẩu/i);
    expectErrorContract(res, "VALIDATION_FAILED");
  });

  test("❌ Tài khoản Google không thể login bằng password", async () => {
    User.findOne.mockResolvedValue({
      id: 2,
      username: "googleuser",
      password: null,
      provider: "google",
    });

    const res = await request(app).post("/api/auth/login").send({
      email: "google@test.com",
      password: "anypass",
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Google/i);
  });

  test("❌ Tài khoản local chưa xác thực email coi như không tồn tại", async () => {
    const hashedPassword = await makeHashedPassword("correctpass");
    User.findOne.mockResolvedValue({
      id: 3,
      email: "pending@test.com",
      username: "needverify",
      password: hashedPassword,
      provider: "local",
      isVerified: false,
    });

    const res = await request(app).post("/api/auth/login").send({
      email: "pending@test.com",
      password: "correctpass",
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Sai email hoặc mật khẩu/i);
    expectErrorContract(res, "AUTH_INVALID_CREDENTIALS");
  });
});

// ─── REGISTER TESTS ─────────────────────────────────────────────────────────

describe("POST /api/auth/register", () => {
  test("✅ Đăng ký chỉ tạo pending — chưa tạo User", async () => {
    User.findOne.mockResolvedValue(null);
    PendingRegistration.findOne.mockResolvedValue(null);
    PendingRegistration.create.mockResolvedValue({ id: 1, email: "new@test.com" });

    const res = await request(app).post("/api/auth/register").send({
      email: "new@test.com",
      password: "password123",
    });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/mã xác thực/i);
    expect(res.body).toMatchObject({ pendingOnly: true, requireEmailVerification: true });
    expect(User.create).not.toHaveBeenCalled();
    expect(PendingRegistration.create).toHaveBeenCalled();
  });

  test("❌ Đăng ký thất bại khi email đã tồn tại", async () => {
    User.findOne.mockResolvedValueOnce({
      id: 1,
      email: "existing@test.com",
    }); // Email đã tồn tại

    const res = await request(app).post("/api/auth/register").send({
      email: "existing@test.com",
      password: "password123",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
    expectErrorContract(res, "AUTH_EMAIL_EXISTS");
  });

  test("❌ Đăng ký thất bại khi thiếu email", async () => {
    const res = await request(app).post("/api/auth/register").send({
      password: "password123",
      // email missing
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/email/i);
  });

  test("❌ Đăng ký thất bại khi email không hợp lệ", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "not-valid-email",
      password: "password123",
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe("Email không hợp lệ");
  });

  test("❌ Đăng ký thất bại khi thiếu password", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "test@test.com",
      // password missing
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/mật khẩu/i);
  });

  test("❌ Xử lý đúng lỗi SequelizeUniqueConstraintError từ DB (pending email)", async () => {
    User.findOne.mockResolvedValue(null);
    PendingRegistration.findOne.mockResolvedValue(null);
    const duplicateError = new Error("ER_DUP_ENTRY");
    duplicateError.name = "SequelizeUniqueConstraintError";
    duplicateError.fields = { email: "email" };
    PendingRegistration.create.mockRejectedValue(duplicateError);

    const res = await request(app).post("/api/auth/register").send({
      email: "dup@test.com",
      password: "password123",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
  });
});

// ─── FORGOT PASSWORD TESTS ──────────────────────────────────────────────────

describe("POST /api/auth/forgot-password", () => {
  test("❌ Email không tồn tại trong hệ thống", async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/forgot-password").send({
      email: "notexist@test.com",
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/không tồn tại/i);
    expectErrorContract(res, "AUTH_EMAIL_NOT_FOUND");
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
    expect(res.body.message).toBe("OK");
  });

  test("❌ Trả về 422 khi thiếu email", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({});

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/email/i);
  });

  test("❌ Tài khoản Google không dùng quên mật khẩu local", async () => {
    User.findOne.mockResolvedValue({
      id: 2,
      email: "google@test.com",
      provider: "google",
      password: null,
      isVerified: true,
    });

    const res = await request(app).post("/api/auth/forgot-password").send({
      email: "google@test.com",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Google/i);
    expectErrorContract(res, "AUTH_GOOGLE_ACCOUNT");
  });
});

// ─── VERIFY RESET CODE TESTS ─────────────────────────────────────────────────

describe("POST /api/auth/verify-reset-code", () => {
  test("✅ Mã reset hợp lệ", async () => {
    User.findOne.mockResolvedValue({ id: 1, email: "user@test.com", isVerified: true });
    PasswordReset.findOne
      .mockResolvedValueOnce({
        id: 1,
        resetCode: "123456",
        used: false,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 phút nữa
      })
      .mockResolvedValueOnce(null);

    const res = await request(app).post("/api/auth/verify-reset-code").send({
      email: "user@test.com",
      code: "123456",
    });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  test("❌ Mã reset đã hết hạn", async () => {
    User.findOne.mockResolvedValue({ id: 1, email: "user@test.com", isVerified: true });
    PasswordReset.findOne
      .mockResolvedValueOnce({
        id: 1,
        resetCode: "123456",
        used: false,
        expiresAt: new Date(Date.now() - 1000),
      })
      .mockResolvedValueOnce(null);

    const res = await request(app).post("/api/auth/verify-reset-code").send({
      email: "user@test.com",
      code: "123456",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/hết hạn/i);
  });

  test("❌ Mã reset không đúng", async () => {
    User.findOne.mockResolvedValue({ id: 1, email: "user@test.com", isVerified: true });
    PasswordReset.findOne.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/verify-reset-code").send({
      email: "user@test.com",
      code: "000000",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/không hợp lệ/i);
    expectErrorContract(res, "AUTH_RESET_CODE_INVALID");
  });
});

// ─── RESET PASSWORD TESTS ────────────────────────────────────────────────────

describe("POST /api/auth/reset-password", () => {
  test("✅ Reset password thành công", async () => {
    const mockUser = {
      id: 1,
      email: "user@test.com",
      isVerified: true,
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
    PasswordReset.findOne
      .mockResolvedValueOnce(mockResetRecord)
      .mockResolvedValueOnce(null);
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
    expect(PasswordReset.update).toHaveBeenCalled();
  });

  test("❌ Mật khẩu mới quá ngắn (< 6 ký tự)", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({
      email: "user@test.com",
      code: "123456",
      newPassword: "abc",
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/6 ký tự/i);
  });

  test("❌ Thiếu các trường bắt buộc", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({
      email: "user@test.com",
      // code và newPassword missing
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toBeDefined();
  });
});

// ─── VERIFY EMAIL TESTS ─────────────────────────────────────────────────────

describe("POST /api/auth/verify-email", () => {
  test("✅ Xác thực email thành công (tạo User từ pending)", async () => {
    const pendingRow = {
      email: "verify@test.com",
      password: "hashed-pass",
      verifyCode: "123456",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      destroy: jest.fn().mockResolvedValue(true),
    };

    User.findOne.mockImplementation(async ({ where }) => {
      if (where?.isVerified === true) return null;
      if (where?.username) return null;
      return null;
    });
    PendingRegistration.findOne.mockResolvedValue(pendingRow);
    User.create.mockResolvedValue({
      id: 11,
      email: "verify@test.com",
      isVerified: true,
    });

    const res = await request(app).post("/api/auth/verify-email").send({
      email: "verify@test.com",
      code: "123456",
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("OK");
    expect(res.body.verified).toBe(true);
    expect(User.create).toHaveBeenCalled();
    expect(pendingRow.destroy).toHaveBeenCalled();
  });

  test("❌ Mã xác thực email sai hoặc đã dùng", async () => {
    User.findOne.mockImplementation(async ({ where }) => {
      if (where?.isVerified === true) return null;
      return null;
    });
    PendingRegistration.findOne.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/verify-email").send({
      email: "verify@test.com",
      code: "000000",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/không hợp lệ/i);
  });
});
