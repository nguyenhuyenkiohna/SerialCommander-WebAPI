-- Bảng meta: phiên bản schema áp dụng trên DB (đồng bộ với config/schemaRegistry.js EXPECTED_SCHEMA_VERSION).
-- Chạy một lần trên mỗi môi trường. Khi gộp thêm migration khác, tăng schema_version cho khớp mã nguồn.

CREATE TABLE IF NOT EXISTS app_schema_registry (
  singleton_id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  schema_version INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO app_schema_registry (singleton_id, schema_version)
VALUES (1, 11)
ON DUPLICATE KEY UPDATE
  schema_version = GREATEST(schema_version, VALUES(schema_version));
