-- Pending sign-ups: no Users row until OTP verified (schema v12)

CREATE TABLE IF NOT EXISTS `PendingRegistrations` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `verifyCode` VARCHAR(128) NOT NULL,
  `expiresAt` DATETIME NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pending_registrations_email` (`email`),
  INDEX `idx_pending_registrations_exp` (`expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE `app_schema_registry`
SET `schema_version` = 12,
    `updated_at` = NOW()
WHERE `singleton_id` = 1
  AND `schema_version` < 12;
