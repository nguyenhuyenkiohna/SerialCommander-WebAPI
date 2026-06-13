const nodemailer = require("nodemailer");
const {
  isDevOtpLogEnabled,
  isEmailTransportConfigured,
} = require("./emailConfig");

const appName = () => process.env.APP_NAME || "Serial Commander";

/** Gmail chỉ chấp nhận From trùng tài khoản đăng nhập SMTP. */
function resolveFromAddress() {
  const name = appName();
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    const from = process.env.EMAIL_FROM;
    if (from && String(from).includes(process.env.GMAIL_USER)) {
      return from;
    }
    return `"${name}" <${process.env.GMAIL_USER}>`;
  }
  return process.env.EMAIL_FROM || `"${name}" <noreply@serialcommander.com>`;
}

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

/** Template HTML thống nhất cho email OTP (đăng ký, quên mật khẩu, …). */
function buildOtpEmailHtml({
  name,
  headerSubtitle,
  bodyHtml,
  code,
  warningItems,
  actionHref,
  actionLabel,
  alternateHref,
  alternateLabel,
}) {
  const warningList = warningItems
    .map((item) => `<li>${item}</li>`)
    .join("\n                  ");

  return `
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
              <h1>${name}</h1>
              <p>${headerSubtitle}</p>
            </div>
            <div class="content">
              ${bodyHtml}
              <div class="code-box">
                <div class="code">${code}</div>
              </div>
              <div class="warning">
                <strong>⚠️ Lưu ý:</strong>
                <ul style="margin: 10px 0; padding-left: 20px;">
                  ${warningList}
                </ul>
              </div>
              <div style="text-align: center;">
                <a href="${actionHref}" class="button">${actionLabel}</a>
              </div>
              <p>Hoặc truy cập: <a href="${alternateHref}">${alternateLabel}</a></p>
            </div>
            <div class="footer">
              <p>Email này được gửi tự động, vui lòng không trả lời.</p>
              <p>&copy; ${new Date().getFullYear()} ${name}. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `;
}

function buildOtpEmailText({ name, headerSubtitle, bodyText, code, warningItems, actionHref }) {
  return `
        ${name} - ${headerSubtitle}

        ${bodyText}

        ${code}

        ${warningItems.map((item) => `- ${item.replace(/<[^>]+>/g, "")}`).join("\n        ")}

        Truy cập: ${actionHref}
      `;
}

const OTP_WARNING_ITEMS = [
  "Mã này có hiệu lực trong <strong>15 phút</strong>",
  "Mã chỉ có thể sử dụng <strong>1 lần</strong>",
];

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
    const name = appName();

    const resetUrl = `${frontendUrl}/forgot-password`;
    const resetActionUrl = `${resetUrl}?code=${resetCode}&email=${encodeURIComponent(to)}`;
    const resetBodyHtml = `
              <p>Xin chào,</p>
              <p>Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Sử dụng mã sau để đặt lại mật khẩu:</p>
              <p>Nhập mã này vào trang đặt lại mật khẩu để tiếp tục.</p>`;

    const mailOptions = {
      from: resolveFromAddress(),
      to: to,
      subject: `[${name}] Mã đặt lại mật khẩu`,
      html: buildOtpEmailHtml({
        name,
        headerSubtitle: "Đặt lại mật khẩu",
        bodyHtml: resetBodyHtml,
        code: resetCode,
        warningItems: [
          ...OTP_WARNING_ITEMS,
          "Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này",
        ],
        actionHref: resetActionUrl,
        actionLabel: "Đặt lại mật khẩu",
        alternateHref: resetUrl,
        alternateLabel: resetUrl,
      }),
      text: buildOtpEmailText({
        name,
        headerSubtitle: "Đặt lại mật khẩu",
        bodyText: `Bạn đã yêu cầu đặt lại mật khẩu. Sử dụng mã sau:

        Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.`,
        code: resetCode,
        warningItems: OTP_WARNING_ITEMS,
        actionHref: resetUrl,
      }),
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Password reset email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    if (isDevOtpLogEnabled()) {
      const reason = isEmailTransportConfigured()
        ? "lỗi SMTP/Gmail"
        : "chưa cấu hình GMAIL_* / SMTP_* (dev chỉ load .env.local trước đây — đã sửa load .env + .env.local)";
      console.warn(
        `[EMAIL_DEV_OTP] Không gửi mail (${reason}) — mã đặt lại mật khẩu cho ${to}: ${resetCode}`
      );
      return { success: true, devLogged: true };
    }
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
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const name = appName();
    const verifyUrl = `${frontendUrl}/verify-email`;
    const verifyActionUrl = `${verifyUrl}?email=${encodeURIComponent(to)}`;
    const verifyBodyHtml = `
              <p>Xin chào,</p>
              <p>Cảm ơn bạn đã đăng ký tài khoản. Vui lòng nhập mã xác thực sau để kích hoạt tài khoản:</p>
              <p>Nhập mã này vào trang xác thực email để tiếp tục.</p>`;

    const mailOptions = {
      from: resolveFromAddress(),
      to,
      subject: `[${name}] Mã xác thực tài khoản`,
      html: buildOtpEmailHtml({
        name,
        headerSubtitle: "Xác thực tài khoản",
        bodyHtml: verifyBodyHtml,
        code: verificationCode,
        warningItems: [
          ...OTP_WARNING_ITEMS,
          "Nếu bạn không thực hiện đăng ký, vui lòng bỏ qua email này",
        ],
        actionHref: verifyActionUrl,
        actionLabel: "Xác thực tài khoản",
        alternateHref: verifyUrl,
        alternateLabel: verifyUrl,
      }),
      text: buildOtpEmailText({
        name,
        headerSubtitle: "Xác thực tài khoản",
        bodyText: `Cảm ơn bạn đã đăng ký tài khoản. Mã xác thực của bạn là:

        Nếu bạn không thực hiện đăng ký, vui lòng bỏ qua email này.`,
        code: verificationCode,
        warningItems: OTP_WARNING_ITEMS,
        actionHref: verifyUrl,
      }),
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email verification code sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    if (isDevOtpLogEnabled()) {
      const reason = isEmailTransportConfigured()
        ? "lỗi SMTP/Gmail (kiểm tra App Password / From)"
        : "chưa cấu hình GMAIL_* / SMTP_* trong .env hoặc .env.local";
      console.warn(
        `[EMAIL_DEV_OTP] Không gửi mail (${reason}) — mã xác thực cho ${to}: ${verificationCode}`
      );
      return { success: true, devLogged: true };
    }
    console.error("Error sending verification email:", error);
    const wrapped = new Error(
      error.message?.includes("Chưa cấu hình")
        ? error.message
        : "Không gửi được email xác thực. Vui lòng thử lại sau."
    );
    wrapped.code = "AUTH_EMAIL_SEND_FAILED";
    wrapped.status = 503;
    throw wrapped;
  }
};

/**
 * Gửi lời mời tham gia phiên MQTT remote qua email.
 * @param {string} to - Email máy trạm
 * @param {string} inviteUrl - URL mời (có invite code)
 * @param {string} hostName - Tên hiển thị của host (tuỳ chọn)
 */
const sendSessionInviteEmail = async (to, inviteUrl, hostName) => {
  const transporter = createTransporter();
  const name = appName();
  const displayHost = hostName || "Host";

  await transporter.sendMail({
    from: resolveFromAddress(),
    to,
    subject: `[${name}] Lời mời tham gia phiên điều khiển Serial`,
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
          .button { display: inline-block; padding: 14px 32px; background: #667eea; color: white !important; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; margin: 20px 0; }
          .note { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; border-radius: 4px; font-size: 13px; margin-top: 16px; }
          .footer { text-align: center; margin-top: 24px; color: #888; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${name}</h1>
            <p>Lời mời tham gia phiên điều khiển</p>
          </div>
          <div class="content">
            <p>Xin chào,</p>
            <p><strong>${displayHost}</strong> đã mời bạn tham gia phiên điều khiển Serial từ xa trên <strong>${name}</strong>.</p>
            <div style="text-align: center;">
              <a href="${inviteUrl}" class="button">Tham gia phiên ngay</a>
            </div>
            <p style="word-break: break-all; font-size: 13px; color: #555;">
              Hoặc copy link sau vào trình duyệt:<br>
              <a href="${inviteUrl}">${inviteUrl}</a>
            </p>
            <div class="note">
              ⚠️ Link này có hiệu lực trong <strong>2 giờ</strong> và chỉ dùng được khi phiên host vẫn đang hoạt động.
              Bạn cần đăng nhập tài khoản ${name} trước khi tham gia.
            </div>
          </div>
          <div class="footer">${name} — Điều khiển Serial từ xa</div>
        </div>
      </body>
      </html>
    `,
  });
};

module.exports = {
  sendPasswordResetEmail,
  sendEmailVerificationCodeEmail,
  sendSessionInviteEmail,
  createTransporter,
};

