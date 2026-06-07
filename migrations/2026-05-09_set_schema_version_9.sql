-- Bump schema registry to version 9 after applying phase upgrades.

INSERT INTO app_schema_registry (singleton_id, schema_version)
VALUES (1, 9)
ON DUPLICATE KEY UPDATE
  schema_version = GREATEST(schema_version, VALUES(schema_version));
