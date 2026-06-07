-- Migration: add unique index for Users.username
-- Notes:
-- - MySQL unique index allows multiple NULL values.
-- - Existing duplicated non-null usernames must be normalized before index creation.

SET @idx_exists = (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'Users'
    AND index_name = 'ux_users_username'
);

-- 1) Rename duplicated usernames by appending user id suffix (only when unique index is missing).
SET @sql = IF(
  @idx_exists = 0,
  'UPDATE Users u JOIN (SELECT username FROM Users WHERE username IS NOT NULL AND TRIM(username) <> "" GROUP BY username HAVING COUNT(*) > 1) d ON d.username = u.username SET u.username = CONCAT(u.username, "_", u.id) WHERE u.username IS NOT NULL AND TRIM(u.username) <> ""',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Add unique index on username (idempotent).
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE `Users` ADD UNIQUE INDEX `ux_users_username` (`username`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
