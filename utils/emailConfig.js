/**
 * Trạng thái cấu hình gửi email (SMTP / Gmail / Ethereal).
 */

function isSmtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD
  );
}

function isGmailConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function isEtherealConfigured() {
  return Boolean(process.env.ETHEREAL_USER && process.env.ETHEREAL_PASS);
}

function isEmailTransportConfigured() {
  return isSmtpConfigured() || isGmailConfigured() || isEtherealConfigured();
}

function isDevOtpLogEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    String(process.env.EMAIL_DEV_LOG_OTP || "").toLowerCase() === "true"
  );
}

function getEmailConfigSummary() {
  if (isSmtpConfigured()) {
    return { mode: "smtp", configured: true, detail: `SMTP ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}` };
  }
  if (isGmailConfigured()) {
    return { mode: "gmail", configured: true, detail: `Gmail ${process.env.GMAIL_USER}` };
  }
  if (isEtherealConfigured()) {
    return { mode: "ethereal", configured: true, detail: "Ethereal (test inbox)" };
  }
  if (process.env.NODE_ENV === "production") {
    return { mode: "none", configured: false, detail: "Chưa cấu hình — production sẽ lỗi khi gửi OTP" };
  }
  if (isDevOtpLogEnabled()) {
    return {
      mode: "dev_log",
      configured: false,
      detail: "EMAIL_DEV_LOG_OTP=true — OTP in log server + API devOtp, không gửi hộp thư thật",
    };
  }
  return { mode: "none", configured: false, detail: "Chưa cấu hình SMTP_* hoặc GMAIL_*" };
}

function logEmailConfigAtStartup() {
  const summary = getEmailConfigSummary();
  const { logInfo, logWarn } = require("../kernels/logging/appLogger");
  if (summary.configured) {
    logInfo("[email] Gửi mail thật đã bật", { mode: summary.mode, detail: summary.detail });
    return;
  }
  logWarn("[email] Không gửi được email OTP tới hộp thư", {
    mode: summary.mode,
    detail: summary.detail,
    hint:
      "Dev: đặt GMAIL_USER + GMAIL_APP_PASSWORD trong .env hoặc .env.local (development load .env rồi .env.local). Tắt fallback log: EMAIL_DEV_LOG_OTP=false",
  });
}

module.exports = {
  isSmtpConfigured,
  isGmailConfigured,
  isEtherealConfigured,
  isEmailTransportConfigured,
  isDevOtpLogEnabled,
  getEmailConfigSummary,
  logEmailConfigAtStartup,
};
