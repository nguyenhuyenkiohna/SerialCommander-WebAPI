# SPA / CORS — checklist

Express CORS được cấu hình trong `kernels/loaders/securityLoader.js`.

## Biến môi trường

| Biến | Mô tả |
|------|--------|
| `FRONTEND_URL` | Một origin cho phép (vd. `https://app.example.com`) |
| `FRONTEND_URLS` | Nhiều origin, phân tách bằng dấu phẩy (ưu tiên hơn nếu set) |

Giá trị không có slash cuối; so khớp với `Origin` header từ trình duyệt.

## Local dev

Khi `NODE_ENV !== "production"`, mọi `http://localhost:*` và `http://127.0.0.1:*` được chấp nhận thêm (ngoài allowlist).

## Hai họ đường dẫn API

- **`/api/*`**: auth, user, upload, firebase, …
- **Root** (không `/api`): `/scenarios`, `/verify`, `/share/...`, …

Chi tiết contract phía SPA: xem project EndUser `docs/INTEGRATION.md`.

Rate limit scenario (mutate/read) và biến `SCENARIO_RL_*`: xem `docs/DEPLOY_RUNBOOK.md`.
