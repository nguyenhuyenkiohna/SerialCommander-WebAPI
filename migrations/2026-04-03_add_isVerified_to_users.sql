-- Bắt buộc chạy trên MySQL nếu bảng Users chưa có cột isVerified (sequelize.sync dùng alter: false).
-- Sau khi chạy, cập nhật tài khoản Google hiện có: UPDATE Users SET isVerified = 1 WHERE provider = 'google';

SET @col_exists = (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'Users'
    AND column_name = 'isVerified'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `Users` ADD COLUMN `isVerified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `provider`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
