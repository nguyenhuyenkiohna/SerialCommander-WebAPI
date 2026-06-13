const adminService = require("../services/adminService");
const appMetrics = require("../../../kernels/metrics/appMetrics");
const { sendError, sendSuccess } = require("../../../kernels/middlewares/errorHandler");

exports.getSharedConfigs = async (req, res) => {
  try {
    const configs = await adminService.getSharedConfigs();
    return sendSuccess(res, 200, "Lấy danh sách cấu hình chia sẻ thành công", { configs });
  } catch (err) {
    return sendError(res, 500, err.message, "ADMIN_GET_SHARED_CONFIGS_FAILED");
  }
}; 

exports.deleteSharedConfig = async (req, res) => {
  try {
    const deleted = await adminService.deleteSharedConfig(req.params.id);
    return sendSuccess(res, 200, "Đã xóa thành công", { deleted });
  } catch (err) {
    return sendError(res, 404, err.message, "ADMIN_DELETE_SHARED_CONFIG_FAILED");
  }
};

exports.approveSharedConfig = async (req, res) => {
  try {
    const approved = await adminService.approveSharedConfig(req.params.id);
    return sendSuccess(res, 200, "Đã duyệt thành công", { approved });
  } catch (err) {
    return sendError(res, 404, err.message, "ADMIN_APPROVE_SHARED_CONFIG_FAILED");
  }
};

exports.getSyncJobsOpsSummary = async (_req, res) => {
  try {
    const summary = await adminService.getSyncJobsOpsSummary();
    return sendSuccess(res, 200, "Tóm tắt outbox đồng bộ kịch bản", { summary });
  } catch (err) {
    return sendError(res, 500, err.message, "ADMIN_SYNC_JOBS_OPS_FAILED");
  }
};

exports.reconcileScenarioOutboxDlq = async (req, res) => {
  try {
    const maxItems = Math.min(50, Math.max(1, Number(req.body?.maxItems) || 20));
    const result = await adminService.reconcileScenarioOutboxDlq(maxItems);
    return sendSuccess(res, 200, "Đã chạy reconciliation DLQ từ MySQL", { reconciliation: result });
  } catch (err) {
    return sendError(res, 500, err.message, "ADMIN_DLQ_RECONCILE_FAILED");
  }
};

exports.getOpsAppMetrics = async (req, res) => {
  try {
    const data = await adminService.getOpsAppMetrics();
    if (req.query.format === "prometheus") {
      res.type("text/plain; charset=utf-8; version=0.0.4");
      return res.send(appMetrics.formatPrometheusExposition(data.gauges, data.counters));
    }
    return sendSuccess(res, 200, "Metrics app + SyncJobs gauges", { metrics: data });
  } catch (err) {
    return sendError(res, 500, err.message, "ADMIN_OPS_METRICS_FAILED");
  }
};
