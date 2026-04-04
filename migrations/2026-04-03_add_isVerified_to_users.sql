-- Bắt buộc chạy trên MySQL nếu bảng Users chưa có cột isVerified (sequelize.sync dùng alter: false).
-- Sau khi chạy, cập nhật tài khoản Google hiện có: UPDATE Users SET isVerified = 1 WHERE provider = 'google';

ALTER TABLE Users
  ADD COLUMN isVerified TINYINT(1) NOT NULL DEFAULT 0
  AFTER provider;
