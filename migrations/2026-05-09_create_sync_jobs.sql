CREATE TABLE IF NOT EXISTS `SyncJobs` (
  `Id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `OperationType` VARCHAR(64) NOT NULL,
  `OperationKey` VARCHAR(191) NOT NULL,
  `ScenarioId` VARCHAR(64) NOT NULL,
  `Payload` LONGTEXT NULL,
  `Status` ENUM('pending','processing','success','failed') NOT NULL DEFAULT 'pending',
  `RetryCount` INT UNSIGNED NOT NULL DEFAULT 0,
  `MaxRetries` INT UNSIGNED NOT NULL DEFAULT 10,
  `NextRetryAt` DATETIME NULL,
  `LastError` TEXT NULL,
  `CreatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ModifiedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `ux_sync_jobs_operation_key` (`OperationKey`),
  KEY `idx_sync_jobs_status_next_retry` (`Status`, `NextRetryAt`),
  KEY `idx_sync_jobs_scenario` (`ScenarioId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
