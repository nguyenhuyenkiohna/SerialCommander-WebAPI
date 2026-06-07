# Runbook triển khai — Serial Commander Web API

Tài liệu ngắn cho vận hành: biến môi trường, CORS, rate limit, phụ thuộc.

## 1. Phụ thuộc runtime

| Thành phần | Vai trò |
|------------|---------|
| **MySQL** | Sequelize / dữ liệu chính |
| **Redis** (khuyến nghị) | Session OAuth; tùy chọn `RATE_LIMIT_REDIS_URL` cho rate limit tập trung |
| **Firebase Admin** | Storage / Firestore theo cấu hình dự án |
| **SMTP / OAuth** | Email verify, Google login — theo `configs` |

## 2. Biến môi trường quan trọng

- **`FRONTEND_URL`** hoặc **`FRONTEND_URLS`**: origin SPA được CORS (không slash cuối). Xem `docs/SPA_INTEGRATION.md`.
- **`JWT` / session secret**: theo `configs/envSecrets.js` và preflight.
- **`SCENARIO_RL_MUTATE_PER_MIN`** (mặc định `30`): số request mutation scenario / phút / IP (import, update, delete, share).
- **`SCENARIO_RL_READ_PER_MIN`** (mặc định `120`): đọc list, chi tiết, export / phút / IP.
- **`RATE_LIMIT_REDIS_URL`**: nếu set, bộ đếm rate limit dùng Redis (nhiều instance Node).

## 3. Quy trình deploy nhanh

1. Chạy test: `npm test`
2. Preflight (nếu dùng): `npm run preflight`
3. Set biến môi trường production (DB, Redis, CORS, secrets).
4. Khởi động: `npm run start` hoặc PM2 theo `pm2.config.js`.
5. Xác minh: `GET /` trả JSON trạng thái; mở Swagger `/api-docs` nếu bật.

## 4. SPA (frontend)

Contract URL và CORS: project EndUser `docs/INTEGRATION.md`. Sinh type TypeScript từ OpenAPI: `npm run types:openapi` trong repo EndUser (khi cả hai repo cùng cây thư mục).

## 5. Ghi chú

- Rate limit scenario **bị tắt trong `NODE_ENV=test`** (trừ `RATE_LIMIT_IN_TEST=1`).
- Scale ngang: bắt buộc **Redis** cho rate limit + session nếu nhiều pod.
