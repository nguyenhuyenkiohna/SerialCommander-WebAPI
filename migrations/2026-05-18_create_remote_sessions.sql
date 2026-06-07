-- Phiên MQTT remote (fallback khi không có Redis hoặc song song audit).
-- TTL logic do app; cột expires_at dùng cho cleanup/query.

CREATE TABLE IF NOT EXISTS remote_sessions (
  session_id CHAR(16) NOT NULL,
  user_id INT NOT NULL,
  mqtt_password_token VARCHAR(128) NOT NULL,
  join_challenge CHAR(32) NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id),
  KEY idx_remote_sessions_expires (expires_at),
  KEY idx_remote_sessions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
