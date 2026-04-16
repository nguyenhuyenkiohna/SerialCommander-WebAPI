const passport = require("passport");
const bcrypt = require("bcryptjs");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { User } = require("../models");
const googleConfig = require("./googleOAuth");

// Chuỗi hash cố định (không rỗng) — MySQL NOT NULL + Sequelize có thể bỏ qua password: "" trong INSERT
const GOOGLE_OAUTH_PASSWORD_PLACEHOLDER = bcrypt.hashSync(
  "__SERIALCOMMANDER_GOOGLE_OAUTH_NO_LOCAL_LOGIN__",
  10
);

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findByPk(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: googleConfig.clientID,
      clientSecret: googleConfig.clientSecret,
      callbackURL: googleConfig.callbackURL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error("Google account has no email"), null);
        }

        // Tìm user đã tồn tại với googleId
        let user = await User.findOne({ where: { googleId: profile.id } });

        if (user) {
          return done(null, user);
        }

        // Tìm user với email đã tồn tại (link account)
        user = await User.findOne({ where: { email } });

        if (user) {
          user.googleId = profile.id;
          // Không đổi provider để tránh "nuốt" tài khoản local hiện có.
          // Nếu user vốn là local thì vẫn cho phép đăng nhập bằng password/forgot-password như cũ.
          if (user.provider === "google") {
            user.isVerified = true;
          }
          if (user.provider === "local") {
            // Với local account, có thể coi là đã xác thực email nếu Google xác thực email
            user.isVerified = true;
          }
          await user.save();
          return done(null, user);
        }

        // Tạo user mới — cột password NOT NULL: dùng placeholder hash (đăng nhập local vẫn bị chặn vì provider === "google")
        user = await User.create({
          googleId: profile.id,
          email,
          username: profile.displayName || email.split("@")[0],
          password: GOOGLE_OAUTH_PASSWORD_PLACEHOLDER,
          provider: "google",
          role: "user",
          isVerified: true,
        });

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

module.exports = passport;





