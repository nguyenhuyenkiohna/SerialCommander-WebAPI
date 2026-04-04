const nodemailer = require("nodemailer");

/**
 * Tạo transporter cho email service
 * Hỗ trợ Gmail, SMTP custom, hoặc Ethereal (chỉ dev/test khi có ETHEREAL_*)
 */
const createTransporter = () => {
  // Nếu có SMTP config, dùng SMTP
  if (process.env.SMTP_HOST && process.env.SMTP_PORT) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }

  // Nếu có Gmail app password, dùng Gmail
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD, // App Password, không phải mật khẩu thường
      },
    });
  }

  // Production: không được gửi mail “im lặng” bằng tài khoản giả — bắt buộc cấu hình SMTP hoặc Gmail
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Chưa cấu hình gửi email: đặt SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD hoặc GMAIL_USER + GMAIL_APP_PASSWORD trong .env (server)."
    );
  }

  // Development/test: Ethereal chỉ khi có ETHEREAL_USER/PASS; nếu không thì báo rõ
  if (process.env.ETHEREAL_USER && process.env.ETHEREAL_PASS) {
    return nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      auth: {
        user: process.env.ETHEREAL_USER,
        pass: process.env.ETHEREAL_PASS,
      },
    });
  }

  throw new Error(
    "Chưa cấu hình gửi email: local/dev cần SMTP_* hoặc GMAIL_* hoặc ETHEREAL_USER + ETHEREAL_PASS (xem .env.example)."
  );
};

/**
 * Gửi email reset password
 * @param {string} to - Email người nhận
 * @param {string} resetCode - Mã reset password (6 chữ số)
 * @returns {Promise} Kết quả gửi email
 */
const sendPasswordResetEmail = async (to, resetCode) => {
  try {
    const transporter = createTransporter();
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const appName = process.env.APP_NAME || "Serial Commander";

    const mailOptions = {
      from: process.env.EMAIL_FROM || `"${appName}" <noreply@serialcommander.com>`,
      to: to,
      subject: `[${appName}] Mã đặt lại mật khẩu`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .code-box { background: white; border: 2px dashed #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
            .code { font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace; }
            .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
            .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${appName}</h1>
              <p>Đặt lại mật khẩu</p>
            </div>
            <div class="content">
              <p>Xin chào,</p>
              <p>Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Sử dụng mã sau để đặt lại mật khẩu:</p>
              
              <div class="code-box">
                <div class="code">${resetCode}</div>
              </div>
              
              <div class="warning">
                <strong>⚠️ Lưu ý:</strong>
                <ul style="margin: 10px 0; padding-left: 20px;">
                  <li>Mã này có hiệu lực trong <strong>15 phút</strong></li>
                  <li>Mã chỉ có thể sử dụng <strong>1 lần</strong></li>
                  <li>Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này</li>
                </ul>
              </div>
              
              <p>Nhập mã này vào trang đặt lại mật khẩu để tiếp tục.</p>
              
              <div style="text-align: center;">
                <a href="${frontendUrl}/reset-password?code=${resetCode}&email=${encodeURIComponent(to)}" class="button">
                  Đặt lại mật khẩu
                </a>
              </div>
              
              <p>Hoặc truy cập: <a href="${frontendUrl}/reset-password">${frontendUrl}/reset-password</a></p>
            </div>
            <div class="footer">
              <p>Email này được gửi tự động, vui lòng không trả lời.</p>
              <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        ${appName} - Đặt lại mật khẩu
        
        Bạn đã yêu cầu đặt lại mật khẩu. Sử dụng mã sau:
        
        ${resetCode}
        
        Mã này có hiệu lực trong 15 phút và chỉ có thể sử dụng 1 lần.
        
        Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.
        
        Truy cập: ${frontendUrl}/reset-password
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Password reset email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Error sending password reset email:", error);
    throw error;
  }
};

/**
 * Gửi email xác thực tài khoản mới (local account)
 * @param {string} to
 * @param {string} verificationCode
 */
const sendEmailVerificationCodeEmail = async (to, verificationCode) => {
  try {
    const transporter = createTransporter();
    const appName = process.env.APP_NAME || "Serial Commander";

    const mailOptions = {
      from: process.env.EMAIL_FROM || `"${appName}" <noreply@serialcommander.com>`,
      to,
      subject: `[${appName}] Mã xác thực tài khoản`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="margin-bottom: 4px;">${appName}</h2>
          <p style="margin-top: 0;">Xác thực tài khoản</p>
          <p>Chào bạn,</p>
          <p>Cảm ơn bạn đã đăng ký tài khoản. Vui lòng nhập mã xác thực sau để kích hoạt tài khoản:</p>
          <div style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #1d4ed8; margin: 16px 0;">
            ${verificationCode}
          </div>
          <p>Mã có hiệu lực trong <strong>15 phút</strong> và chỉ dùng 1 lần.</p>
          <p>Nếu bạn không thực hiện thao tác này, vui lòng bỏ qua email.</p>
        </div>
      `,
      text: `
${appName} - Xác thực tài khoản

Mã xác thực của bạn là: ${verificationCode}
Mã có hiệu lực trong 15 phút và chỉ dùng 1 lần.
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email verification code sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Error sending verification email:", error);
    throw error;
  }
};

module.exports = {
  sendPasswordResetEmail,
  sendEmailVerificationCodeEmail,
  createTransporter,
};

