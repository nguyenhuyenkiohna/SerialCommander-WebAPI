# Serial Commander — Web API

Backend Express + Sequelize (MySQL), Firebase Admin, JWT, Swagger tại `/api-docs`.

## Biến môi trường (thống nhất)

| Môi trường | File mặc định | Ghi chú |
|------------|----------------|---------|
| **Production** (VPS, `NODE_ENV=production`) | **`.env`** một file duy nhất | PM2 không cần `ENV_FILE`. |
| **Development** | **`.env.local`** | `npm run dev` hoặc `npm run start:dev`. |
| **Ghi đè** | Đặt **`ENV_FILE`** | Ví dụ: `ENV_FILE=.env.production NODE_ENV=production node server.js` để test prod local. |

**Lưu ý:** Node không tự đọc `.env`; project dùng `dotenv` với logic trên trong `index.js`.

Tạo secret: `npm run secrets`

## Chạy local

```bash
cp .env.example .env.local
# Điền DATABASE_*, JWT_SECRET, SESSION_SECRET (≥16 ký tự production; dev có fallback), …
npm install
npm run dev
```

Hoặc ép nạp file cụ thể: `npm run start:dev` (dùng `env-cmd` + `.env.local`).

## Kiểm thử

```bash
npm test
```

## Phiên bản schema DB

- File SQL: `migrations/0000_app_schema_registry.sql` — tạo bảng `app_schema_registry` và `schema_version`.
- Mã nguồn: `config/schemaRegistry.js` — **`EXPECTED_SCHEMA_VERSION`**. Khi thêm migration lớn, tăng số trong code và cập nhật DB (`UPDATE app_schema_registry SET schema_version=…`).
- Khởi động: nếu DB **thiếu** bảng → **cảnh báo** (không chặn). Nếu **version < expected** trong **production** → **`process.exit(1)`**.

## Production deployment

`sequelize.sync({ alter: false })` — không tự đổi schema; chạy SQL trong `migrations/` (nhớ **`0000`** trước các file khác nếu dùng registry).

1. Trên server chỉ cần **`.env`** (copy từ máy dev đã kiểm tra, **không commit**).
2. Chạy migration MySQL đúng thứ tự.
3. `npm ci --omit=dev`, sau đó `pm2 reload pm2.config.js` hoặc `npm run start`.

Script gợi ý: `bash scripts/deploy.sh`
Checklist rollback: `docs/DEPLOY_ROLLBACK_CHECKLIST.md`

## Deploy SFTP (`release 2.py`)

1. `cp deploy-config.example.json deploy-config.json` và điền host/user/path (**`deploy-config.json` đã vào `.gitignore`**).
2. Mật khẩu SSH: biến **`DEPLOY_PASSWORD`** hoặc nhập tay (không lưu trong JSON).
3. File env đẩy lên server: mặc định **`.env.production` → `.env`** trên VPS (cấu hình `env_upload_local` / `env_remote_name` trong JSON).
4. Chạy: `python3 "release 2.py"` (trong thư mục WebAPI).
