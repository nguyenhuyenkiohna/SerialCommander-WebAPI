-- Dọn index trùng trên Users (sequelize.sync lặp tạo username_2..N, email_2..N).
-- Giữ: PRIMARY, username, email; thêm googleId UNIQUE nếu chưa có.

DROP PROCEDURE IF EXISTS sc_cleanup_users_indexes;
DELIMITER //
CREATE PROCEDURE sc_cleanup_users_indexes()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE idx_name VARCHAR(64);
  DECLARE cur CURSOR FOR
    SELECT DISTINCT s.index_name
    FROM information_schema.statistics s
    WHERE s.table_schema = DATABASE()
      AND s.table_name = 'Users'
      AND s.index_name NOT IN ('PRIMARY', 'username', 'email', 'googleId')
      AND (
        s.index_name REGEXP '^username_[0-9]+$'
        OR s.index_name REGEXP '^email_[0-9]+$'
      );
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO idx_name;
    IF done THEN
      LEAVE read_loop;
    END IF;
    SET @drop_sql = CONCAT('ALTER TABLE `Users` DROP INDEX `', idx_name, '`');
    PREPARE stmt FROM @drop_sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur;
END //
DELIMITER ;

CALL sc_cleanup_users_indexes();
DROP PROCEDURE IF EXISTS sc_cleanup_users_indexes;

SET @google_col := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'Users'
    AND column_name = 'googleId'
);
SET @google_idx := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'Users'
    AND index_name = 'googleId'
);
SET @ddl := IF(
  @google_col > 0 AND @google_idx = 0,
  'ALTER TABLE `Users` ADD UNIQUE INDEX `googleId` (`googleId`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Cho phép user Google OAuth không có username/password local
ALTER TABLE `Users` MODIFY COLUMN `username` VARCHAR(255) NULL;
ALTER TABLE `Users` MODIFY COLUMN `password` VARCHAR(255) NULL;
