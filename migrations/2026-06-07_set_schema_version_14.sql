UPDATE `app_schema_registry`
SET `schema_version` = 14,
    `updated_at` = NOW()
WHERE `singleton_id` = 1
  AND `schema_version` < 14;
