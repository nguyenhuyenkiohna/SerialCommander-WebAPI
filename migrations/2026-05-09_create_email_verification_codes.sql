-- Migration: dedicated table for email verification OTP
-- Purpose: separate account verification OTP from password reset flow

CREATE TABLE IF NOT EXISTS `EmailVerificationCodes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `UserId` INT NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `verifyCode` VARCHAR(16) NOT NULL,
  `expiresAt` DATETIME NOT NULL,
  `used` TINYINT(1) NOT NULL DEFAULT 0,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_email_verification_user` (`UserId`),
  INDEX `idx_email_verification_email` (`email`),
  INDEX `idx_email_verification_exp` (`expiresAt`),
  CONSTRAINT `fk_email_verification_user`
    FOREIGN KEY (`UserId`) REFERENCES `Users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
