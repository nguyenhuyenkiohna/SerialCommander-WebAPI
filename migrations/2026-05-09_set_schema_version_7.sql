-- Bump schema registry after applying all required migrations.
-- Run this LAST in deployment order.

INSERT INTO app_schema_registry (singleton_id, schema_version)
VALUES (1, 7)
ON DUPLICATE KEY UPDATE
  schema_version = GREATEST(schema_version, VALUES(schema_version));
