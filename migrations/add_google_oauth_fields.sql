-- Migration: Add Google OAuth fields to Users table
-- Run this SQL manually or temporarily change sequelize.sync({ alter: true }) in server.js

-- Add googleId column (nullable, unique)
SET @col_exists = (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'Users'
    AND column_name = 'googleId'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `Users` ADD COLUMN `googleId` VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'Users'
    AND index_name = 'googleId'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE `Users` ADD UNIQUE INDEX `googleId` (`googleId`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add provider column (enum: 'local' or 'google', default: 'local')
SET @col_exists = (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'Users'
    AND column_name = 'provider'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `Users` ADD COLUMN `provider` ENUM(''local'', ''google'') DEFAULT ''local''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Make username and password nullable (for Google OAuth users)
ALTER TABLE `Users` MODIFY COLUMN `username` VARCHAR(255) NULL;
ALTER TABLE `Users` MODIFY COLUMN `password` VARCHAR(255) NULL;





