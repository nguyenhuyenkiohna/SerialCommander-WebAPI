# Danh sách thư viện — Serial Commander WebAPI (Backend)

> Mã nguồn trong gói nộp **không kèm thư mục `node_modules`**. Để cài lại toàn bộ
> thư viện bên dưới, mở thư mục backend và chạy:
>
> ```bash
> npm install
> ```
>
> Lệnh trên đọc `package.json` + `package-lock.json` và tải đúng phiên bản đã ghi.

- **Nền tảng:** Node.js + Express (REST API)
- **Cơ sở dữ liệu:** MySQL (qua Sequelize ORM), Redis (cache/session)
- **Trình quản lý gói:** npm

---

## 1. Thư viện chạy thực tế (dependencies)

| Thư viện | Phiên bản | Mục đích |
|----------|-----------|----------|
| express | ^4.19.2 | Web framework, định tuyến HTTP |
| express-async-errors | ^3.1.1 | Bắt lỗi trong handler async |
| express-router-group | ^0.1.4 | Nhóm route theo prefix |
| express-session | ^1.18.2 | Quản lý phiên đăng nhập |
| express-validator | ^7.0.1 | Kiểm tra dữ liệu đầu vào |
| body-parser | ^1.20.2 | Phân tích body request |
| cors | ^2.8.5 | Cấu hình CORS |
| helmet | ^8.1.0 | Tăng cường bảo mật HTTP header |
| sequelize | ^6.37.5 | ORM thao tác MySQL |
| mysql2 | ^3.9.7 | Driver kết nối MySQL |
| ioredis | ^5.10.1 | Client Redis |
| connect-redis | ^9.0.0 | Lưu session vào Redis |
| jsonwebtoken | ^9.0.2 | Sinh & xác thực JWT |
| passport | ^0.7.0 | Khung xác thực |
| passport-google-oauth20 | ^2.0.0 | Đăng nhập Google OAuth2 |
| bcryptjs | ^2.4.3 | Băm mật khẩu |
| firebase-admin | ^13.7.0 | Tích hợp Firebase (Firestore/Auth) |
| @aws-sdk/client-s3 | ^3.1075.0 | Lưu trữ đối tượng trên S3 |
| cloudinary | ^2.10.0 | Lưu trữ & xử lý ảnh trên Cloudinary |
| multer | ^1.4.5-lts.1 | Nhận file upload (multipart) |
| nodemailer | ^7.0.11 | Gửi email |
| zod | ^4.4.3 | Định nghĩa & kiểm tra schema |
| json-source-map | ^0.6.1 | Map vị trí lỗi trong JSON |
| slugify | ^1.6.6 | Tạo slug từ chuỗi |
| dotenv | ^16.4.5 | Nạp biến môi trường từ `.env` |
| rootpath | ^0.1.2 | Đặt đường dẫn gốc cho require |
| swagger-jsdoc | ^6.2.8 | Sinh tài liệu OpenAPI từ comment |
| swagger-ui-express | ^5.0.0 | Giao diện Swagger UI |
| @opentelemetry/sdk-node | ^0.217.0 | SDK telemetry (tracing) |
| @opentelemetry/auto-instrumentations-node | ^0.75.0 | Tự động đo lường |
| @opentelemetry/exporter-trace-otlp-http | ^0.217.0 | Xuất trace qua OTLP/HTTP |
| @opentelemetry/resources | ^2.7.1 | Mô tả resource cho telemetry |
| @opentelemetry/semantic-conventions | ^1.40.0 | Quy ước thuộc tính telemetry |

## 2. Thư viện phục vụ phát triển / kiểm thử (devDependencies)

| Thư viện | Phiên bản | Mục đích |
|----------|-----------|----------|
| jest | ^29.7.0 | Khung kiểm thử (unit/integration) |
| supertest | ^7.0.0 | Kiểm thử HTTP endpoint |
| nodemon | ^3.1.0 | Tự khởi động lại khi sửa code |
| sequelize-cli | ^6.6.2 | CLI tạo & chạy migration |
| umzug | ^3.8.0 | Quản lý migration |
| env-cmd | ^11.0.0 | Nạp `.env` theo môi trường |
| git-branch-is | ^4.0.0 | Kiểm tra nhánh git khi chạy script |

---

*Phiên bản chính thức được khóa trong `package-lock.json` kèm theo mã nguồn.*
