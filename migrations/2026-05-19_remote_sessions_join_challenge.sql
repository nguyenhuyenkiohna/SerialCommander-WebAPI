-- Bổ sung join_challenge cho DB đã tạo trước khi cột có trong 2026-05-18 (idempotent).
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'remote_sessions'
    AND COLUMN_NAME = 'join_challenge'
);

SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE remote_sessions ADD COLUMN join_challenge CHAR(32) NULL AFTER mqtt_password_token',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
