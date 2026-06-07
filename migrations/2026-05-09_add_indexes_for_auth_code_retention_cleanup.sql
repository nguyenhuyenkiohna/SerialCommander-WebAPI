-- Improve retention cleanup on used codes by indexing updatedAt + used.

SET @idx_exists = (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'EmailVerificationCodes'
    AND index_name = 'idx_email_verification_used_updated'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE `EmailVerificationCodes` ADD INDEX `idx_email_verification_used_updated` (`used`, `updatedAt`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'PasswordResets'
    AND index_name = 'idx_password_reset_used_updated'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE `PasswordResets` ADD INDEX `idx_password_reset_used_updated` (`used`, `updatedAt`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
