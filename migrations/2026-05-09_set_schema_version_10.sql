-- Bump schema registry to version 10 after retention cleanup index migration.

INSERT INTO app_schema_registry (singleton_id, schema_version)
VALUES (1, 10)
ON DUPLICATE KEY UPDATE
  schema_version = GREATEST(schema_version, VALUES(schema_version));
