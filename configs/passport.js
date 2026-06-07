const passport = require("passport");
const bcrypt = require("bcryptjs");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { User } = require("../models");
const { getGoogleOAuthConfig } = require("./googleOAuth");
const { normalizeEmail } = require("../utils/emailValidation");

const GOOGLE_OAUTH_PASSWORD_PLACEHOLDER = bcrypt.hashSync(
  "__SERIALCOMMANDER_GOOGLE_OAUTH_NO_LOCAL_LOGIN__",
  10
);

let googleStrategyRegistered = false;

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findByPk(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

function hasGoogleCredentials() {
  const { clientID, clientSecret } = getGoogleOAuthConfig();
  return Boolean(clientID) && Boolean(clientSecret);
}

function registerGoogleStrategy() {
  if (googleStrategyRegistered) {
    return true;
  }
  const googleConfig = getGoogleOAuthConfig();
  if (!googleConfig.clientID || !googleConfig.clientSecret) {
    return false;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: googleConfig.clientID,
        clientSecret: googleConfig.clientSecret,
        callbackURL: googleConfig.callbackURL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const rawEmail = profile.emails?.[0]?.value;
          if (!rawEmail) {
            return done(new Error("Google account has no email"), null);
          }
          const email = normalizeEmail(rawEmail);

          let user = await User.findOne({ where: { googleId: profile.id } });
          if (user) {
            return done(null, user);
          }

          user = await User.findOne({ where: { email } });
          if (user) {
            if (user.provider === "local") {
              // Chặn auto-link Google vào tài khoản local để tránh account takeover:
              // kẻ tấn công không thể dùng Google account cùng email để đăng nhập vào tài khoản local.
              return done(null, false, { message: "EMAIL_LINKED_TO_LOCAL" });
            }
            user.googleId = profile.id;
            if (user.provider === "google") {
              user.isVerified = true;
            }
            await user.save();
            return done(null, user);
          }

          user = await User.create({
            googleId: profile.id,
            email,
            username: null,
            password: GOOGLE_OAUTH_PASSWORD_PLACEHOLDER,
            provider: "google",
            role: "user",
            isVerified: true,
          });
          user._isNewOAuthUser = true;

          return done(null, user);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );

  googleStrategyRegistered = true;
  return true;
}

function isGoogleOAuthReady() {
  return registerGoogleStrategy();
}

if (!registerGoogleStrategy() && process.env.NODE_ENV !== "test") {
  console.warn(
    "[passport] Google OAuth tắt — thiếu GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (đặt trong .env.local khi NODE_ENV=development)"
  );
}

module.exports = passport;
module.exports.isGoogleOAuthReady = isGoogleOAuthReady;
/** @deprecated dùng isGoogleOAuthReady() — giữ tương thích test cũ */
Object.defineProperty(module.exports, "googleOAuthEnabled", {
  get() {
    return isGoogleOAuthReady();
  },
  enumerable: true,
});
