require("express-router-group");
const express = require("express");

const { verifyToken, verifyAdmin } = require("../kernels/middlewares/authMiddleware");
const { validate } = require("kernels/validations");
const { createSimpleRateLimit } = require("../kernels/middlewares/simpleRateLimit");
const { sendError } = require("../kernels/middlewares/errorHandler");
const scenarioController = require("../modules/config/controllers/scenarioController");
const adminController = require("../modules/admin/controllers/adminController");

const SHARE_CODE_PATTERN = /^[a-z0-9]{4,16}$/i;

function validateShareCode(req, res, next) {
  const { shareCode } = req.params;
  if (!shareCode || !SHARE_CODE_PATTERN.test(shareCode)) {
    return sendError(res, 400, "Share code không hợp lệ.", "SHARE_CODE_INVALID");
  }
  next();
}

const router = express.Router({ mergeParams: true });
const verifyRateLimit = createSimpleRateLimit({ windowMs: 60 * 1000, maxRequests: 40 });
/** Ghi / import / share / xóa — chặn abuse body lớn hoặc spam mutation (in-process; scale ngang bằng RATE_LIMIT_REDIS_URL). */
const scenarioMutateRateLimit = createSimpleRateLimit({
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.SCENARIO_RL_MUTATE_PER_MIN ?? 30),
});
/** Đọc danh sách / chi tiết / export — giới hạn riêng để hạn chế scrape. */
const scenarioReadRateLimit = createSimpleRateLimit({
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.SCENARIO_RL_READ_PER_MIN ?? 120),
});

// Middleware để đọc body dạng text (cho kiểm tra file .json thô)
const textBodyParser = express.text({ type: "text/plain", limit: "2mb" });


// Config routes for user:   verifyToken   validate([])
/**
 * @swagger
 * /scenarios/myscenarios:
 *   get:
 *     summary: Danh sách kịch bản của user
 *     tags: [Scenario]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: legacy_array
 *         schema:
 *           type: string
 *           enum: ["1"]
 *         description: Nếu "1", trả mảng JSON thuần (tương thích cũ). Mặc định envelope { message, scenarios }.
 *     responses:
 *       200:
 *         description: Envelope chuẩn hoặc mảng (legacy)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/ScenarioListSuccessResponse'
 *                 - type: array
 *                   items: { type: object, additionalProperties: true }
 * /scenarios/{scenarioId}:
 *   get:
 *     summary: Chi tiết kịch bản (field kịch bản gộp root cùng message)
 *     tags: [Scenario]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: scenarioId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Kịch bản
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ScenarioMergedResourceSuccessResponse'
 * /scenarios/export/{scenarioId}:
 *   get:
 *     summary: Xuất kịch bản (JSON, Content-Disposition attachment)
 *     tags: [Scenario]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: scenarioId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: File JSON
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ScenarioMergedResourceSuccessResponse'
 */
/// Các API thay đổi cấu hình serial: thêm, xóa, xuất, chia sẻ,
router.group("/scenarios", verifyToken, (router) => {
  //------------------------------------------------
  router.post("/import", scenarioMutateRateLimit, scenarioController.createScenario);
  router.post("/update/:scenarioId", scenarioMutateRateLimit, scenarioController.updateScenario);
  router.get("/export/:scenarioId", scenarioReadRateLimit, scenarioController.exportScenarioById);
  router.post("/share/:scenarioId", scenarioMutateRateLimit, scenarioController.shareScenarioById);
  //------------------------------------------------
  router.get("/myscenarios", scenarioReadRateLimit, scenarioController.getScenariosByUserId);
  router.delete("/:scenarioId", scenarioMutateRateLimit, scenarioController.deleteScenario);
  router.get("/:scenarioId", scenarioReadRateLimit, scenarioController.getScenarioById);
});

/// Các API lấy về cấu hình dựa trên mã chia sẻ
/**
 * @swagger
 * /verify:
 *   post:
 *     summary: Kiểm tra tính hợp lệ của payload kịch bản
 *     tags: [Scenario]
 *     responses:
 *       200:
 *         description: Kết quả kiểm tra kịch bản
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ScenarioVerifySuccessResponse'
 *       429:
 *         description: Rate limit
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/verify", verifyRateLimit, scenarioController.verifyScenario);
/// Kiểm tra cú pháp file .json kịch bản (gửi nội dung file với Content-Type: text/plain)
/**
 * @swagger
 * /verify-file:
 *   post:
 *     summary: Kiểm tra cú pháp file kịch bản JSON
 *     tags: [Scenario]
 *     responses:
 *       200:
 *         description: Kết quả kiểm tra file
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ScenarioVerifyFileSuccessResponse'
 *       429:
 *         description: Rate limit
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/verify-file", verifyRateLimit, textBodyParser, scenarioController.verifyScenarioFile);
/**
 * @swagger
 * /share/{shareCode}:
 *   get:
 *     summary: Lấy kịch bản theo mã chia sẻ (public)
 *     tags: [Scenario]
 *     parameters:
 *       - in: path
 *         name: shareCode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Kịch bản (field gộp root)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ScenarioMergedResourceSuccessResponse'
 *       404:
 *         description: Không tìm thấy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/share/:shareCode/availability", validateShareCode, scenarioController.getShareAvailability);
router.get("/share/:shareCode", validateShareCode, scenarioController.getScenarioByShareCode);

// Admin routes
router.group("/admin/shared-configs", verifyToken, (router) => {
  router.use(verifyAdmin);
  router.get("/", adminController.getSharedConfigs);
  router.delete("/:id", adminController.deleteSharedConfig);
  router.patch("/:id/approve", adminController.approveSharedConfig);
});

/**
 * @swagger
 * /admin/ops/sync-jobs:
 *   get:
 *     summary: Tóm tắt SyncJobs (đồng bộ MySQL/Firestore) cho vận hành
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Thống kê theo trạng thái + mẫu failed gần nhất
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncJobsOpsSummaryEnvelope'
 *       401:
 *         description: Không có hoặc token không hợp lệ
 */
router.group("/admin/ops/sync-jobs", verifyToken, (router) => {
  router.use(verifyAdmin);
  router.get("/", adminController.getSyncJobsOpsSummary);
});

/**
 * @swagger
 * /admin/ops/metrics:
 *   get:
 *     summary: Counters process + gauges SyncJobs (JSON hoặc ?format=prometheus)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [prometheus]
 *         description: Nếu `prometheus` trả body text exposition
 *     responses:
 *       200:
 *         description: metrics JSON hoặc Prometheus text (`format=prometheus`)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppOpsMetricsEnvelope'
 */
router.group("/admin/ops/metrics", verifyToken, (router) => {
  router.use(verifyAdmin);
  router.get("/", adminController.getOpsAppMetrics);
});

module.exports = router;
