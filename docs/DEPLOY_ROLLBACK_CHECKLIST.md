# Production Deploy Rollback Checklist

Use this checklist when a production deploy fails after new backend migrations or app changes.

## 1) Initial triage (first 5-10 minutes)

1. Confirm app status:
   - `pm2 ls`
   - `pm2 logs --lines 200`
2. Confirm active release path and env file:
   - app directory contains expected `.env`
   - secrets (`JWT_SECRET`, `SESSION_SECRET`, DB credentials) are present
3. Check schema gate logs:
   - look for `Schema DB (...) lệch mã nguồn (...)`

## 2) Fast rollback decision

Rollback immediately if at least one condition is true:
- API cannot boot (`pm2` keeps restarting)
- login/register flow fails globally
- core endpoints return 5xx continuously
- schema mismatch is detected in production startup

## 3) App rollback (without DB rollback)

1. Re-deploy previous stable app package/commit.
2. Keep DB as-is.
3. Ensure previous app can run with newer schema (forward-compatible path).
4. Reload:
   - `NODE_ENV=production pm2 reload pm2.config.js --update-env`

## 4) DB rollback policy

Prefer **fix-forward** for DB whenever possible.

- For additive migrations (new tables/indexes/columns), do not drop immediately unless required.
- For destructive migration side-effects, use explicit rollback SQL scripts reviewed by maintainer.

### Current phase 3 migration notes

- `2026-05-09_add_unique_index_users_username.sql`
  - If index creation causes failure due to unexpected duplicates, stop deploy and inspect:
    - `SELECT username, COUNT(*) FROM Users WHERE username IS NOT NULL GROUP BY username HAVING COUNT(*) > 1;`
  - Fix usernames, then rerun migration.

- `2026-05-09_create_email_verification_codes.sql`
  - Safe additive table; normally no rollback needed.

- `2026-05-09_add_indexes_for_auth_code_lookup.sql`
  - Additive indexes for OTP/reset lookup and cleanup performance.

- `2026-05-09_add_indexes_for_auth_code_retention_cleanup.sql`
  - Additive indexes on `used + updatedAt` for retention cleanup performance.

- `2026-05-09_set_schema_version_10.sql`
  - Only run after all required migrations completed.

## 5) Verify after rollback/fix

1. Health/API smoke:
   - `GET /`
   - `POST /api/auth/login`
   - `POST /api/auth/register` (if allowed in env)
2. Check logs for 5xx in last 10 minutes.
3. Confirm schema registry:
   - `SELECT schema_version FROM app_schema_registry WHERE singleton_id = 1;`

## 6) Post-incident

1. Record root cause and exact failing migration/commit.
2. Add/adjust migration pre-check scripts.
3. Update this checklist if new failure mode is found.
