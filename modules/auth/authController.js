const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { User, PasswordReset } = require("../../models");
const passport = require("../../configs/passport");
const { sendPasswordResetEmail, sendEmailVerificationCodeEmail } = require("../../utils/emailService");

const JWT_SECRET = process.env.JWT_SECRET || "secretKey";

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, username: user.username || user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "1d" }
  );
};

const createOtpCode = () => crypto.randomInt(100000, 1000000).toString();

exports.login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: "Tên đăng nhập và mật khẩu là bắt buộc." });
  }

  try {
    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu" });
    }

    // Kiểm tra nếu user đăng nhập bằng Google (không có password)
    if (user.provider === "google" || !user.password) {
      return res.status(401).json({ message: "Tài khoản này đăng nhập bằng Google. Vui lòng sử dụng đăng nhập Google." });
    }

    // Tài khoản local bắt buộc phải xác thực email trước (dùng !== true để bắt cả trường hợp DB thiếu cột isVerified → undefined)
    if (user.provider === "local" && user.isVerified !== true) {
      return res.status(400).json({
        message: "Tài khoản chưa được xác thực email. Vui lòng kiểm tra email và nhập mã xác thực.",
        code: "EMAIL_NOT_VERIFIED",
        email: user.email,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu" });
    }

    const token = generateToken(user);
    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.register = async (req, res) => {
  const { username, password, email } = req.body;
  try {
    // Kiểm tra email và password có được cung cấp
    if (!email || !password) {
      return res.status(400).json({ message: "Email và mật khẩu là bắt buộc" });
    }

    // Kiểm tra email đã tồn tại chưa
    const existingUserByEmail = await User.findOne({ where: { email } });
    if (existingUserByEmail) {
      return res.status(400).json({ message: "Email này đã được sử dụng. Vui lòng sử dụng email khác hoặc đăng nhập." });
    }

    // Kiểm tra username đã tồn tại chưa (nếu có username)
    if (username) {
      const existingUserByUsername = await User.findOne({ where: { username } });
      if (existingUserByUsername) {
        return res.status(400).json({ message: "Tên đăng nhập đã tồn tại" });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      username,
      password: hashedPassword,
      email,
      role: "user", // mặc định
      provider: "local",
      isVerified: false,
    });

    // Tạo mã xác thực email (6 chữ số), hết hạn sau 15 phút
    const verifyCode = createOtpCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    // Xóa mã cũ nếu có (cùng user) rồi tạo mã mới
    await PasswordReset.destroy({ where: { UserId: newUser.id } });
    await PasswordReset.create({
      UserId: newUser.id,
      email,
      resetCode: verifyCode,
      expiresAt,
      used: false,
    });

    try {
      await sendEmailVerificationCodeEmail(email, verifyCode);
    } catch (emailError) {
      console.error("Send verification email error:", emailError);
      return res.status(201).json({
        message: "Đăng ký thành công nhưng chưa gửi được email xác thực. Vui lòng yêu cầu gửi lại mã xác thực.",
        requireEmailVerification: true,
        email,
        emailSent: false,
      });
    }

    res.status(201).json({
      message: "Đăng ký thành công. Vui lòng kiểm tra email để xác thực tài khoản.",
      requireEmailVerification: true,
      email,
      emailSent: true,
    });
  } catch (error) {
    const sqlMsg = error.parent?.sqlMessage || "";
    console.error("Register error:", error);
    if (sqlMsg) console.error("SQL:", sqlMsg);

    // Thiếu cột / schema (hay gặp: bảng PasswordResets chưa có UserId)
    if (sqlMsg && (/Unknown column/i.test(sqlMsg) || /doesn't exist/i.test(sqlMsg))) {
      return res.status(500).json({
        message:
          "Lỗi cơ sở dữ liệu khi đăng ký (schema có thể chưa đồng bộ). Kiểm tra bảng PasswordResets có cột UserId; xem file migrations/2026-01-06_add_userid_to_passwordresets.sql và log server (pm2 logs).",
        code: "DB_SCHEMA",
      });
    }

    // Xử lý lỗi duplicate entry từ database
    if (error.name === 'SequelizeUniqueConstraintError' || error.code === 'ER_DUP_ENTRY') {
      if (error.fields && error.fields.email) {
        return res.status(400).json({ message: "Email này đã được sử dụng. Vui lòng sử dụng email khác hoặc đăng nhập." });
      }
      if (error.fields && error.fields.username) {
        return res.status(400).json({ message: "Tên đăng nhập đã tồn tại" });
      }
      return res.status(400).json({ message: "Thông tin đăng ký đã tồn tại trong hệ thống" });
    }

    // Lỗi validation
    if (error.name === 'SequelizeValidationError') {
      const messages = error.errors.map(e => e.message).join(', ');
      return res.status(400).json({ message: messages });
    }

    // Lỗi khác
    res.status(500).json({ message: "Lỗi server. Vui lòng thử lại sau." });
  }
};

// Verify email code after register
exports.verifyEmail = async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ message: "Email và mã xác thực là bắt buộc" });
  }

  try {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ message: "Người dùng không tồn tại" });
    }

    if (user.provider !== "local") {
      return res.status(400).json({ message: "Tài khoản không yêu cầu xác thực email bằng mã." });
    }

    if (user.isVerified) {
      return res.status(200).json({ message: "Tài khoản đã được xác thực trước đó." });
    }

    const verifyRecord = await PasswordReset.findOne({
      where: {
        UserId: user.id,
        resetCode: code,
        used: false,
      },
    });
    if (!verifyRecord) {
      return res.status(400).json({ message: "Mã xác thực không hợp lệ hoặc đã được sử dụng" });
    }

    if (new Date() > verifyRecord.expiresAt) {
      return res.status(400).json({ message: "Mã xác thực đã hết hạn. Vui lòng yêu cầu mã mới." });
    }

    await user.update({ isVerified: true });
    await verifyRecord.update({ used: true });
    await PasswordReset.destroy({ where: { UserId: user.id, used: true } });

    return res.status(200).json({ message: "Xác thực email thành công. Bạn có thể đăng nhập." });
  } catch (error) {
    console.error("Verify email error:", error);
    return res.status(500).json({ message: "Lỗi server. Vui lòng thử lại sau." });
  }
};

// Resend email verification code for local account
exports.resendVerificationCode = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email là bắt buộc" });
  }

  try {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ message: "Người dùng không tồn tại" });
    }
    if (user.provider !== "local") {
      return res.status(400).json({ message: "Tài khoản không yêu cầu xác thực email bằng mã." });
    }
    if (user.isVerified) {
      return res.status(200).json({ message: "Tài khoản đã được xác thực trước đó." });
    }

    const verifyCode = createOtpCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    await PasswordReset.destroy({ where: { UserId: user.id } });
    await PasswordReset.create({
      UserId: user.id,
      email,
      resetCode: verifyCode,
      expiresAt,
      used: false,
    });

    await sendEmailVerificationCodeEmail(email, verifyCode);
    return res.status(200).json({ message: "Đã gửi lại mã xác thực email." });
  } catch (error) {
    console.error("Resend verification code error:", error);
    return res.status(500).json({ message: "Lỗi server. Vui lòng thử lại sau." });
  }
};

// Google OAuth - initiate authentication
exports.googleAuth = (req, res, next) => {
  passport.authenticate("google", {
    scope: ["profile", "email"],
    state: true,
  })(req, res, next);
};

// Google OAuth - handle callback
exports.googleCallback = (req, res, next) => {
  passport.authenticate("google", { session: true }, (err, user) => {
    if (err) {
      console.error("Google OAuth error:", err);
      return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173"}/login?error=oauth_failed`);
    }

    if (!user) {
      return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173"}/login?error=oauth_failed`);
    }

    // Generate JWT token
    const token = generateToken(user);

    // Không đưa JWT qua query string (dễ rò qua logs/referer). Dùng URL fragment (#) để FE đọc,
    // fragment không được gửi lên server trong HTTP request.
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173"}/login#token=${token}`);
  })(req, res, next);
};

// Forgot Password - Request reset code
exports.requestPasswordReset = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email là bắt buộc" });
  }

  try {
    // Kiểm tra user có tồn tại không
    const user = await User.findOne({ where: { email } });
    
    // Không tiết lộ email có tồn tại hay không (security best practice)
    if (!user) {
      // Vẫn trả về success để không tiết lộ thông tin
      return res.json({ 
        message: "Nếu email tồn tại trong hệ thống, bạn sẽ nhận được mã đặt lại mật khẩu qua email." 
      });
    }

    // Kiểm tra user có password không (không cho reset password của Google OAuth users)
    if (user.provider === "google" || !user.password) {
      return res.status(400).json({ 
        message: "Tài khoản này đăng nhập bằng Google. Vui lòng sử dụng đăng nhập Google." 
      });
    }

    if (user.provider === "local" && user.isVerified !== true) {
      return res.status(400).json({
        message: "Tài khoản chưa xác thực email. Vui lòng xác thực email trước khi đặt lại mật khẩu."
      });
    }

    // Tạo mã reset 6 chữ số bằng CSPRNG
    const resetCode = crypto.randomInt(100000, 1000000).toString();
    
    // Thời gian hết hạn: 15 phút
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    // Xóa các reset code cũ của user này
    await PasswordReset.destroy({ where: { UserId: user.id } });

    // Lưu reset code mới
    await PasswordReset.create({
      UserId: user.id,
      email,
      resetCode,
      expiresAt,
      used: false,
    });

    // Gửi email
    try {
      await sendPasswordResetEmail(email, resetCode);
      res.json({ 
        message: "Nếu email tồn tại trong hệ thống, bạn sẽ nhận được mã đặt lại mật khẩu qua email." 
      });
    } catch (emailError) {
      console.error("Error sending email:", emailError);
      // Vẫn trả về success để không tiết lộ lỗi email
      // Trong production, nên log và xử lý riêng
      res.json({ 
        message: "Nếu email tồn tại trong hệ thống, bạn sẽ nhận được mã đặt lại mật khẩu qua email." 
      });
    }
  } catch (error) {
    console.error("Request password reset error:", error);
    res.status(500).json({ message: "Lỗi server. Vui lòng thử lại sau." });
  }
};

// Verify reset code
exports.verifyResetCode = async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ message: "Email và mã reset là bắt buộc" });
  }

  try {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(400).json({ message: "Mã reset không hợp lệ hoặc đã được sử dụng" });
    }

    const resetRecord = await PasswordReset.findOne({
      where: {
        UserId: user.id,
        resetCode: code,
        used: false,
      },
    });

    if (!resetRecord) {
      return res.status(400).json({ message: "Mã reset không hợp lệ hoặc đã được sử dụng" });
    }

    // Kiểm tra mã đã hết hạn chưa
    if (new Date() > resetRecord.expiresAt) {
      return res.status(400).json({ message: "Mã reset đã hết hạn. Vui lòng yêu cầu mã mới." });
    }

    res.json({ 
      message: "Mã reset hợp lệ",
      valid: true 
    });
  } catch (error) {
    console.error("Verify reset code error:", error);
    res.status(500).json({ message: "Lỗi server. Vui lòng thử lại sau." });
  }
};

// Reset password với code
exports.resetPassword = async (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    return res.status(400).json({ message: "Email, mã reset và mật khẩu mới là bắt buộc" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: "Mật khẩu phải có ít nhất 6 ký tự" });
  }

  try {
    // Tìm reset record
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ message: "Người dùng không tồn tại" });
    }

    const resetRecord = await PasswordReset.findOne({
      where: {
        UserId: user.id,
        resetCode: code,
        used: false,
      },
    });

    if (!resetRecord) {
      return res.status(400).json({ message: "Mã reset không hợp lệ hoặc đã được sử dụng" });
    }

    // Kiểm tra mã đã hết hạn chưa
    if (new Date() > resetRecord.expiresAt) {
      return res.status(400).json({ message: "Mã reset đã hết hạn. Vui lòng yêu cầu mã mới." });
    }

    // Tìm user
    // Hash password mới
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Cập nhật password
    await user.update({ password: hashedPassword });

    // Đánh dấu reset code đã được sử dụng
    await resetRecord.update({ used: true });

    // Xóa tất cả reset code cũ của email này
    await PasswordReset.destroy({
      where: {
        UserId: user.id,
        used: true 
      }
    });

    res.json({ message: "Đặt lại mật khẩu thành công. Vui lòng đăng nhập với mật khẩu mới." });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Lỗi server. Vui lòng thử lại sau." });
  }
};
