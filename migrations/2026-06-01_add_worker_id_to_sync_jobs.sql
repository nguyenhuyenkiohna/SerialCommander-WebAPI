-- SyncJobs: worker claim cho scenario-sync (import kịch bản enqueue job)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'SyncJobs'
    AND COLUMN_NAME = 'WorkerId'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE SyncJobs ADD COLUMN WorkerId VARCHAR(64) NULL DEFAULT NULL AFTER Status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'SyncJobs'
    AND INDEX_NAME = 'idx_sync_jobs_worker'
);
SET @sql := IF(
  @idx_exists = 0,
  'ALTER TABLE SyncJobs ADD INDEX idx_sync_jobs_worker (WorkerId, Status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
