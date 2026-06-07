process.env.NODE_ENV = "test";
process.env.OTP_CODE_PEPPER = "pepper-for-tests";
process.env.AUTH_CODE_USED_RETENTION_DAYS = "7";

require("rootpath")();

jest.mock("models", () => {
  return {
    User: {
      findOne: jest.fn(),
    },
    PasswordReset: {
      findOne: jest.fn(),
      create: jest.fn(),
      destroy: jest.fn(),
    },
    EmailVerificationCode: {
      findOne: jest.fn(),
      create: jest.fn(),
      destroy: jest.fn(),
    },
  };
});

const { PasswordReset, EmailVerificationCode } = require("models");
const authDomainService = require("./authDomainService");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("authDomainService cleanup", () => {
  test("cleanupExpiredAuthCodes xóa expired + used theo retention", async () => {
    EmailVerificationCode.destroy
      .mockResolvedValueOnce(2) // expired
      .mockResolvedValueOnce(1); // used old
    PasswordReset.destroy
      .mockResolvedValueOnce(3) // expired
      .mockResolvedValueOnce(4); // used old

    const result = await authDomainService.cleanupExpiredAuthCodes();

    expect(result).toMatchObject({
      deletedExpiredVerification: 2,
      deletedExpiredReset: 3,
      deletedUsedVerification: 1,
      deletedUsedReset: 4,
      retentionDays: 7,
    });
    expect(EmailVerificationCode.destroy).toHaveBeenCalledTimes(2);
    expect(PasswordReset.destroy).toHaveBeenCalledTimes(2);
  });
});

