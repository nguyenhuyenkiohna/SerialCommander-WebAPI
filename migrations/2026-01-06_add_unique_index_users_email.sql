-- Migration: add unique index for Users.email to ensure no duplicate accounts
-- Run manually or via migration runner

SET @idx_exists = (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'Users'
    AND index_name = 'ux_users_email'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE `Users` ADD UNIQUE INDEX `ux_users_email` (`email`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


