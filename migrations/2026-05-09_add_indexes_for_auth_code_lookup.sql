-- Improve lookup/cleanup performance for hashed auth codes.

SET @idx_exists = (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'EmailVerificationCodes'
    AND index_name = 'idx_email_verification_lookup'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE `EmailVerificationCodes` ADD INDEX `idx_email_verification_lookup` (`UserId`, `verifyCode`, `used`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'EmailVerificationCodes'
    AND index_name = 'idx_email_verification_cleanup'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE `EmailVerificationCodes` ADD INDEX `idx_email_verification_cleanup` (`expiresAt`, `used`)',
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
    AND index_name = 'idx_password_reset_cleanup'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE `PasswordResets` ADD INDEX `idx_password_reset_cleanup` (`expiresAt`, `used`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
