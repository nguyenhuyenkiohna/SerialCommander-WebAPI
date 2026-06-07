process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-contract";

require("rootpath")();

const express = require("express");
const request = require("supertest");

jest.mock("kernels/middlewares/authMiddleware", () => ({
  verifyToken: (req, _res, next) => {
    req.user = { id: 1, role: "user" };
    next();
  },
}));

jest.mock("kernels/middlewares/uploadMiddleware", () => ({
  single: () => (req, _res, next) => {
    req.file = null;
    next();
  },
}));

jest.mock("kernels/middlewares/firebaseStorageUploadMiddleware", () => ({
  single: () => (req, res, cb) => {
    const multer = require("multer");
    cb(new multer.MulterError("LIMIT_FILE_SIZE", "file"));
  },
}));

jest.mock("modules/config/controllers/firebaseStorageController", () => ({
  getStatus: (_req, res) => res.status(200).json({ ok: true }),
  uploadFile: (_req, res) => res.status(201).json({ ok: true }),
  listFiles: (_req, res) => res.status(200).json({ ok: true }),
  deleteFile: (_req, res) => res.status(200).json({ ok: true }),
  downloadFile: (_req, res) => res.status(200).json({ ok: true }),
  signedDownloadUrl: (_req, res) => res.status(200).json({ ok: true }),
}));

describe("Upload/Firebase error contract integration", () => {
  test("POST /api/upload trả contract chuẩn khi thiếu file", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/upload", require("routes/uploadRoutes"));

    const res = await request(app).post("/api/upload").send({}).expect(400);
    expect(res.body.message).toMatch(/Không có file/i);
    expect(res.body).toHaveProperty("error.code", "UPLOAD_FILE_MISSING");
  });

  test("POST /api/firebase/storage/upload trả contract chuẩn khi multer lỗi", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/firebase", require("routes/firebaseRoutes"));

    const res = await request(app).post("/api/firebase/storage/upload").send({}).expect(400);
    expect(res.body).toHaveProperty("error.code", "FIREBASE_UPLOAD_INVALID_FILE");
    expect(typeof res.body.error.message).toBe("string");
  });
});
