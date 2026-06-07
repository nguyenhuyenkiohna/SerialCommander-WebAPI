-- Migration: add UserId FK to PasswordResets to avoid orphan reset codes
-- Run manually or via migration runner

SET @col_exists = (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'PasswordResets'
    AND column_name = 'UserId'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `PasswordResets` ADD COLUMN `UserId` INT NULL AFTER `email`',
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
    AND index_name = 'idx_password_resets_user_id'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE `PasswordResets` ADD INDEX `idx_password_resets_user_id` (`UserId`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists = (
  SELECT COUNT(1)
  FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'PasswordResets'
    AND constraint_name = 'fk_password_resets_user_id'
);
SET @sql = IF(
  @fk_exists = 0,
  'ALTER TABLE `PasswordResets` ADD CONSTRAINT `fk_password_resets_user_id` FOREIGN KEY (`UserId`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Optional: backfill UserId for existing rows (if any) based on email
-- UPDATE PasswordResets pr
-- JOIN Users u ON pr.email = u.email
-- SET pr.UserId = u.id
-- WHERE pr.UserId IS NULL;


