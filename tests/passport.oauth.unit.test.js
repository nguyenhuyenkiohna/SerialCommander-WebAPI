process.env.NODE_ENV = "test";

jest.mock("../models", () => ({
  User: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock("../configs/googleOAuth", () => ({
  getGoogleOAuthConfig: jest.fn().mockReturnValue({
    clientID: "mock-client-id",
    clientSecret: "mock-client-secret",
    callbackURL: "/mock/cb",
  }),
}));

jest.mock("../utils/emailValidation", () => ({
  normalizeEmail: jest.fn((e) => e.toLowerCase().trim()),
}));

let verifyCallback = null;

jest.mock("passport-google-oauth20", () => ({
  Strategy: class MockGoogleStrategy {
    constructor(options, verify) {
      this.name = "google";
      verifyCallback = verify;
    }
  },
}));

// Require passport config to register the strategy and capture verifyCallback
require("../configs/passport");

const { User } = require("../models");

describe("Passport Google OAuth strategy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyCallback = null;
    // Re-require to re-capture the callback (reset module state)
    jest.resetModules();
    jest.mock("../models", () => ({
      User: { findOne: jest.fn(), create: jest.fn() },
    }));
    jest.mock("../configs/googleOAuth", () => ({
      getGoogleOAuthConfig: jest.fn().mockReturnValue({
        clientID: "mock-client-id",
        clientSecret: "mock-client-secret",
        callbackURL: "/mock/cb",
      }),
    }));
    jest.mock("../utils/emailValidation", () => ({
      normalizeEmail: jest.fn((e) => e.toLowerCase().trim()),
    }));
    jest.mock("passport-google-oauth20", () => ({
      Strategy: class MockGoogleStrategy {
        constructor(options, verify) {
          this.name = "google";
          verifyCallback = verify;
        }
      },
    }));
    require("../configs/passport");
  });

  it("returns existing user when googleId already exists", async () => {
    const existingUser = { id: 1, googleId: "g123", email: "test@google.com", provider: "google" };
    const { User: U } = require("../models");
    U.findOne.mockResolvedValueOnce(existingUser); // found by googleId

    const done = jest.fn();
    const profile = { id: "g123", emails: [{ value: "test@google.com" }] };
    await verifyCallback("token", "refresh", profile, done);

    expect(done).toHaveBeenCalledWith(null, existingUser);
  });

  it("blocks auto-link when email exists with provider=local (account takeover prevention)", async () => {
    const { User: U } = require("../models");
    U.findOne.mockResolvedValueOnce(null); // not found by googleId
    U.findOne.mockResolvedValueOnce({ id: 2, email: "local@test.com", provider: "local" }); // found by email

    const done = jest.fn();
    const profile = { id: "g456", emails: [{ value: "local@test.com" }] };
    await verifyCallback("token", "refresh", profile, done);

    expect(done).toHaveBeenCalledWith(null, false, { message: "EMAIL_LINKED_TO_LOCAL" });
  });

  it("creates new user when email is completely new", async () => {
    const { User: U } = require("../models");
    U.findOne.mockResolvedValue(null); // not found by googleId or email
    const newUser = { id: 3, email: "new@google.com", provider: "google" };
    U.create.mockResolvedValue(newUser);

    const done = jest.fn();
    const profile = { id: "g789", displayName: "New User", emails: [{ value: "new@google.com" }] };
    await verifyCallback("token", "refresh", profile, done);

    expect(U.create).toHaveBeenCalledWith(
      expect.objectContaining({ googleId: "g789", provider: "google" })
    );
    expect(done).toHaveBeenCalledWith(null, newUser);
  });

  it("returns error when profile has no email", async () => {
    const done = jest.fn();
    const profile = { id: "g000", emails: [] };
    await verifyCallback("token", "refresh", profile, done);

    expect(done).toHaveBeenCalledWith(expect.any(Error), null);
  });
});
