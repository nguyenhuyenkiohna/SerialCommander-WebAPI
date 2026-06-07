-- Bump schema registry to version 8.
-- Run this AFTER applying all migrations up to phase 3.

INSERT INTO app_schema_registry (singleton_id, schema_version)
VALUES (1, 8)
ON DUPLICATE KEY UPDATE
  schema_version = GREATEST(schema_version, VALUES(schema_version));
