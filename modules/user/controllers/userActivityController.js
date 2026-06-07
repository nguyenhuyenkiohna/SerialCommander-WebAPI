const UserActivityService = require("../services/userActivityService");
const { sendError, sendSuccess } = require("../../../kernels/middlewares/errorHandler");

/**
 * Controller để xử lý các request liên quan đến User Activity
 */

/**
 * Lấy lịch sử hoạt động của user hiện tại
 * GET /api/user/activities
 */
exports.getUserActivities = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      limit = 50,
      offset = 0,
      activityType,
      startDate,
      endDate,
      orderBy = 'CreatedAt',
      orderDirection = 'DESC'
    } = req.query;

    const result = await UserActivityService.getUserActivities(userId, {
      limit,
      offset,
      activityType,
      startDate,
      endDate,
      orderBy,
      orderDirection
    });

    return sendSuccess(res, 200, "Lấy lịch sử hoạt động thành công", result);
  } catch (error) {
    console.error("Error in getUserActivities:", error);
    return sendError(res, 500, "Lỗi khi lấy lịch sử hoạt động", "USER_ACTIVITY_FETCH_FAILED", {
      detail: error.message,
    });
  }
};

/**
 * Lấy thống kê hoạt động của user hiện tại
 * GET /api/user/activities/stats
 */
exports.getUserActivityStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    const stats = await UserActivityService.getUserActivityStats(
      userId,
      startDate || null,
      endDate || null
    );

    return sendSuccess(res, 200, "Lấy thống kê hoạt động thành công", { stats });
  } catch (error) {
    console.error("Error in getUserActivityStats:", error);
    return sendError(res, 500, "Lỗi khi lấy thống kê hoạt động", "USER_ACTIVITY_STATS_FAILED", {
      detail: error.message,
    });
  }
};

/**
 * Tạo activity log mới (thường được gọi từ middleware hoặc các controller khác)
 * POST /api/user/activities
 */
exports.createActivity = async (req, res) => {
  try {
    const userId = req.user.id;
    const { activityType, description, metadata } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');

    if (!activityType) {
      return sendError(res, 400, "activityType là bắt buộc", "USER_ACTIVITY_TYPE_REQUIRED");
    }

    const activity = await UserActivityService.createActivity(
      userId,
      activityType,
      description,
      metadata,
      ipAddress,
      userAgent
    );

    return sendSuccess(res, 201, "Tạo activity log thành công", { activity });
  } catch (error) {
    console.error("Error in createActivity:", error);
    return sendError(res, 500, "Lỗi khi tạo activity log", "USER_ACTIVITY_CREATE_FAILED", {
      detail: error.message,
    });
  }
};




