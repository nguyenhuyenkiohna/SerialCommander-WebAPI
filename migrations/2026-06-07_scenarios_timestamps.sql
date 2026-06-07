-- Scenarios: CreatedAt / ModifiedAt — DEFAULT + ON UPDATE (giống SyncJobs).
-- Backfill bản ghi cũ; idempotent khi chạy lại migrate.

UPDATE Scenarios
SET CreatedAt = COALESCE(CreatedAt, CURRENT_TIMESTAMP),
    ModifiedAt = COALESCE(ModifiedAt, CURRENT_TIMESTAMP)
WHERE CreatedAt IS NULL OR ModifiedAt IS NULL;

SET @created_at_nullable := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Scenarios'
    AND COLUMN_NAME = 'CreatedAt'
  LIMIT 1
);

SET @sql := IF(
  @created_at_nullable = 'YES',
  'ALTER TABLE Scenarios
     MODIFY COLUMN CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     COMMENT ''Thời điểm tạo kịch bản''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @modified_at_nullable := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Scenarios'
    AND COLUMN_NAME = 'ModifiedAt'
  LIMIT 1
);

SET @sql := IF(
  @modified_at_nullable = 'YES',
  'ALTER TABLE Scenarios
     MODIFY COLUMN ModifiedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ON UPDATE CURRENT_TIMESTAMP
     COMMENT ''Thời điểm sửa kịch bản lần cuối''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
