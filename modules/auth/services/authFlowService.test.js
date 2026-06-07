process.env.NODE_ENV = "test";
process.env.OTP_CODE_PEPPER = "test-pepper-16-chars-min";

const { verifyEmailCode, resetPasswordWithCode, requestPasswordReset } = require("./authFlowService");

jest.mock("../../../models", () => ({
  User: { findOne: jest.fn() },
  PasswordReset: { update: jest.fn(), destroy: jest.fn() },
}));

jest.mock("../../../utils/emailService", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ devLogged: false }),
  sendEmailVerificationCodeEmail: jest.fn().mockResolvedValue({ devLogged: false }),
}));

jest.mock("./authDomainService", () => ({
  createOtpCode: jest.fn(() => "123456"),
  findUserByEmail: jest.fn(),
  upsertPasswordResetCode: jest.fn().mockResolvedValue(undefined),
  findEmailVerificationRecord: jest.fn(),
  findPasswordResetRecord: jest.fn(),
  isGoogleOnlyAccount: jest.fn((user) => user?.provider === "google" || !user?.password),
}));

jest.mock("./pendingRegistrationService", () => ({
  findPendingByEmailAndCode: jest.fn(),
  activatePendingRegistration: jest.fn().mockResolvedValue(undefined),
}));

const { User, PasswordReset } = require("../../../models");
const {
  findUserByEmail,
  findEmailVerificationRecord,
  findPasswordResetRecord,
  upsertPasswordResetCode,
} = require("./authDomainService");
const { findPendingByEmailAndCode, activatePendingRegistration } = require("./pendingRegistrationService");

describe("authFlowService unit tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("verifyEmailCode", () => {
    it("success: activates pending registration", async () => {
      User.findOne.mockResolvedValue(null);
      const pending = { id: 1, email: "test@test.com" };
      findPendingByEmailAndCode.mockResolvedValue(pending);

      const result = await verifyEmailCode("test@test.com", "123456");
      expect(result).toEqual({ success: true, created: true });
      expect(activatePendingRegistration).toHaveBeenCalledWith(pending, undefined);
    });

    it("success: verifies legacy local user via EmailVerificationCode", async () => {
      User.findOne.mockResolvedValue(null);
      findPendingByEmailAndCode.mockResolvedValue(null);
      const mockUser = {
        id: 1,
        provider: "local",
        isVerified: false,
        update: jest.fn().mockResolvedValue({}),
      };
      findUserByEmail.mockResolvedValue(mockUser);
      const mockRecord = {
        id: 1,
        expiresAt: new Date(Date.now() + 60000),
        destroy: jest.fn().mockResolvedValue({}),
      };
      findEmailVerificationRecord.mockResolvedValue(mockRecord);

      const result = await verifyEmailCode("test@test.com", "123456");
      expect(result).toEqual({ success: true, created: false });
      expect(mockUser.update).toHaveBeenCalledWith({ isVerified: true });
      expect(mockRecord.destroy).toHaveBeenCalled();
    });

    it("alreadyVerified: returns early if already verified", async () => {
      User.findOne.mockResolvedValue({ id: 1, provider: "local", isVerified: true });

      const result = await verifyEmailCode("test@test.com", "123456");
      expect(result.alreadyVerified).toBe(true);
    });

    it("throws if code expired (legacy user)", async () => {
      User.findOne.mockResolvedValue(null);
      findPendingByEmailAndCode.mockResolvedValue(null);
      findUserByEmail.mockResolvedValue({ id: 1, provider: "local", isVerified: false });
      findEmailVerificationRecord.mockResolvedValue({
        id: 1,
        expiresAt: new Date(Date.now() - 60000),
      });

      await expect(verifyEmailCode("test@test.com", "123456")).rejects.toMatchObject({
        code: "AUTH_OTP_EXPIRED",
      });
    });

    it("throws if record not found (code used or invalid)", async () => {
      User.findOne.mockResolvedValue(null);
      findPendingByEmailAndCode.mockResolvedValue(null);
      findUserByEmail.mockResolvedValue({ id: 1, provider: "local", isVerified: false });
      findEmailVerificationRecord.mockResolvedValue(null);

      await expect(verifyEmailCode("test@test.com", "123456")).rejects.toMatchObject({
        code: "AUTH_OTP_INVALID",
      });
    });

    it("throws if user not found", async () => {
      User.findOne.mockResolvedValue(null);
      findPendingByEmailAndCode.mockResolvedValue(null);
      findUserByEmail.mockResolvedValue(null);

      await expect(verifyEmailCode("test@test.com", "123456")).rejects.toMatchObject({
        code: "AUTH_OTP_INVALID",
      });
    });

    it("throws if wrong provider (Google account, legacy path)", async () => {
      User.findOne.mockResolvedValue(null);
      findPendingByEmailAndCode.mockResolvedValue(null);
      findUserByEmail.mockResolvedValue({ id: 1, provider: "google", isVerified: false });

      await expect(verifyEmailCode("test@test.com", "123456")).rejects.toMatchObject({
        code: "AUTH_OTP_INVALID",
      });
    });
  });

  describe("resetPasswordWithCode", () => {
    it("success: updates password and cleans up records", async () => {
      const mockUser = { id: 1, isVerified: true, update: jest.fn().mockResolvedValue({}) };
      findUserByEmail.mockResolvedValue(mockUser);
      findPasswordResetRecord.mockResolvedValue({
        id: 10,
        expiresAt: new Date(Date.now() + 60000),
      });
      PasswordReset.update.mockResolvedValue([1]);
      PasswordReset.destroy.mockResolvedValue(1);

      const result = await resetPasswordWithCode("test@test.com", "123456", "NewPass1!");
      expect(result.success).toBe(true);
      expect(mockUser.update).toHaveBeenCalled();
      expect(PasswordReset.destroy).toHaveBeenCalled();
    });

    it("throws if atomic claim fails (concurrent request already won)", async () => {
      const mockUser = { id: 1, isVerified: true, update: jest.fn() };
      findUserByEmail.mockResolvedValue(mockUser);
      findPasswordResetRecord.mockResolvedValue({
        id: 10,
        expiresAt: new Date(Date.now() + 60000),
      });
      PasswordReset.update.mockResolvedValue([0]);

      await expect(
        resetPasswordWithCode("test@test.com", "123456", "NewPass1!")
      ).rejects.toMatchObject({ code: "AUTH_RESET_CODE_INVALID" });
      expect(mockUser.update).not.toHaveBeenCalled();
    });

    it("throws if code expired", async () => {
      findUserByEmail.mockResolvedValue({ id: 1, isVerified: true });
      findPasswordResetRecord.mockResolvedValue({
        id: 10,
        expiresAt: new Date(Date.now() - 60000),
      });

      await expect(
        resetPasswordWithCode("test@test.com", "123456", "NewPass1!")
      ).rejects.toMatchObject({ code: "AUTH_RESET_CODE_EXPIRED" });
    });

    it("throws if user not found", async () => {
      findUserByEmail.mockResolvedValue(null);
      await expect(
        resetPasswordWithCode("test@test.com", "123456", "NewPass1!")
      ).rejects.toMatchObject({ code: "AUTH_RESET_CODE_INVALID" });
    });
  });

  describe("requestPasswordReset", () => {
    it("googleAccount: Google-only account", async () => {
      findUserByEmail.mockResolvedValue({ id: 1, provider: "google", password: null, isVerified: true });
      const result = await requestPasswordReset("google@test.com");
      expect(result.googleAccount).toBe(true);
    });

    it("notFound: email not found or unverified", async () => {
      findUserByEmail.mockResolvedValue(null);
      const result = await requestPasswordReset("notfound@test.com");
      expect(result.notFound).toBe(true);
    });

    it("success for valid local user", async () => {
      findUserByEmail.mockResolvedValue({
        id: 1,
        provider: "local",
        password: "hash",
        isVerified: true,
      });

      const result = await requestPasswordReset("user@test.com");
      expect(result.sent).toBe(true);
      expect(upsertPasswordResetCode).toHaveBeenCalled();
    });
  });
});
