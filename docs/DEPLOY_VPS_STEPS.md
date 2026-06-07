# Triển khai VPS & MySQL — hướng dẫn thủ công

Các bước **SSH / MySQL trên server** bạn phải làm trên máy của mình (AI không đăng nhập VPS được).

## Bước 1 — File `deploy-config.json` (máy dev)

Đã có thể tạo sẵn trong repo (đã `.gitignore`, **không push Git**).

- Nếu host/user/path khác: sửa `deploy-config.json` cho đúng VPS hiện tại.

## Bước 2 — File `.env` trên VPS

**Ý nghĩa:** Trên server, app production chỉ đọc **một file `.env`** (xem `README.md`).

**Cách A — Dùng script SFTP (khuyến nghị sau khi có `deploy-config.json`):**

1. Trên máy dev, đảm bảo có **`.env.production`** (đủ `JWT_SECRET`, `SESSION_SECRET`, `DATABASE_*`, OAuth, …).
2. Trong thư mục `SerialCommander-WebAPI-main`:

   ```bash
   export DEPLOY_PASSWORD='mật-khẩu-SSH-của-bạn'
   python3 "release 2.py"
   ```

   Script sẽ upload `.env.production` lên VPS với tên **`.env`** (theo `env_upload_local` / `env_remote_name`), chạy `npm run preflight` rồi mới `pm2 reload`.
   Mặc định script dùng **SSH host key verification** (`known_hosts`), chỉ bật `allow_unknown_host=true` khi test nhanh.

**Cách B — Tay:**

1. Vào VPS: `ssh huyenntt@api.toolhub.app` (user/host theo `deploy-config.json`).
2. Tạo/sửa file: `nano ~/serialcommander_webapi/.env` (đường dẫn đúng `remote_path`).
3. Dán nội dung giống production (copy từ `.env.production` trên máy dev), lưu.

**Kiểm tra nhanh trên VPS:**

```bash
cd /home/huyenntt/serialcommander_webapi
test -f .env && echo "OK: có .env" || echo "Thiếu .env"
```

## Bước 3 — Chạy migration `0000_app_schema_registry.sql` (MySQL)

Chạy **trước** (hoặc cùng lúc với các migration khác) nếu muốn bật kiểm tra `schema_version` khi khởi động API.

**Trên máy có `mysql` client** (có thể là máy dev hoặc SSH vào VPS rồi chạy nếu VPS có MySQL client và quyền tới host DB):

```bash
cd /đường/dẫn/SerialCommander-WebAPI-main

mysql -h DATABASE_HOST -P 3306 -u DATABASE_USER -p DATABASE_NAME \
  < migrations/0000_app_schema_registry.sql
```

Thay `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_NAME` bằng giá trị trong **`.env` / `.env.production`** của bạn (`DATABASE_HOST`, `DATABASE_USERNAME`, `DATABASE_NAME`). Sau `-p` nhập mật khẩu MySQL.

**Kiểm tra đã áp dụng:**

```bash
mysql -h ... -u ... -p ... -e "SELECT * FROM app_schema_registry WHERE singleton_id=1;"
```

Kết quả mong đợi: một dòng `singleton_id=1`, `schema_version` ≥ `EXPECTED_SCHEMA_VERSION` trong `config/schemaRegistry.js`.

## Bước 3.1 — Migration đầy đủ (khuyến nghị)

Từ máy dev (có `mysql` client và file `.env.production`):

```bash
cd GR2
./scripts/migrate-production.sh
```

Hoặc trên VPS sau khi `git pull`:

```bash
AUTO_RUN_MIGRATION=true AUTO_APPROVE_MIGRATION=true AUTO_RELOAD_PM2=true ENV_FILE=.env ./scripts/deploy.sh
```

Thứ tự file nằm trong `scripts/migrate-mysql.sh` (gồm `2026-05-19_cleanup_users_duplicate_indexes.sql` nếu DB cũ bị trùng index).

Kết quả: `SELECT schema_version FROM app_schema_registry WHERE singleton_id=1` → **≥ 11**.

Chi tiết deploy + email: `docs/DEPLOY_PRODUCTION.md`.

## Bước 4 — Khởi động lại API trên VPS

Sau khi có `.env` và đã chạy SQL:

```bash
cd /home/huyenntt/serialcommander_webapi
npm ci --omit=dev --legacy-peer-deps
npm run preflight
NODE_ENV=production pm2 reload pm2.config.js --update-env
pm2 ls
```

`npm run preflight` sẽ fail-fast nếu thiếu biến env bắt buộc, DB chưa reachable, hoặc `schema_version` chưa đạt mức yêu cầu.

## Khi gặp lỗi

| Hiện tượng | Gợi ý |
|------------|--------|
| `deploy-config.json` không tìm thấy | File phải nằm cùng thư mục với `release 2.py`. |
| SSH sai mật khẩu | Dùng `DEPLOY_PASSWORD` hoặc nhập đúng user SSH (không phải mật khẩu MySQL). |
| API exit ngay sau start, production | Xem `schema_version` trong DB có **≥** `EXPECTED_SCHEMA_VERSION`; hoặc chạy đủ migration. |
| Không có bảng `app_schema_registry` | Chỉ **cảnh báo** trong log; chạy `0000_app_schema_registry.sql` để bật kiểm tra version. |

## Rollback

Xem checklist chi tiết tại `docs/DEPLOY_ROLLBACK_CHECKLIST.md`.

## CI/CD tự động (GitHub Actions)

Repo đã có:
- `.github/workflows/ci.yml`: chạy test + coverage trên mọi push/PR.
- `.github/workflows/deploy.yml`: chạy test trước, sau đó deploy tự động khi push `main` hoặc chạy thủ công (`workflow_dispatch`).

Secrets cần cấu hình trên GitHub:
- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_SSH_PASSPHRASE` (nếu key có passphrase)
- `DEPLOY_APP_DIR` (ví dụ `/home/huyenntt/serialcommander_webapi`)
