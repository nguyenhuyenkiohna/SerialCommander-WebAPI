const scenarioService = require("../services/scenarioService");
const { validateScenarioFile } = require("../services/scenarioFileValidator");
const { logError, logWarn } = require("../../../kernels/logging/appLogger");
const {
  scenarioMergedResourceSuccessSchema,
  scenarioListEnvelopeSchema,
} = require("../../../kernels/validations/responseSchemas");
const { sendError, sendSuccess } = require("../../../kernels/middlewares/errorHandler");
const {
  mapScenarioOutput,
  mapScenarioFromMaybeDataValues,
  mapScenarioForExport,
} = require("../services/scenarioPresenter");

function respondScenarioError(res, error, fallbackCode) {
  const meta = { message: error.message, fallbackCode };
  if (error.statusCode === 404) {
    logWarn("scenario route not found", meta);
  } else {
    logError("scenario route error", { ...meta, stack: error.stack });
  }
  return sendError(res, error.statusCode || 500, error.message, error.code || fallbackCode);
}

/**
 * Creates a new scenario for the authenticated user.
 * @alias /scenarios/import
 */
exports.createScenario = async (req, res) => {
  const userId = req.user.id;
  try {
    const newScenario = await scenarioService.createScenario(userId, req.body);
    return sendSuccess(res, 202, "Đã chấp nhận tạo kịch bản — đang đồng bộ nội dung lên Firestore.", {
      scenario: newScenario,
      syncStatus: "pending",
    });
  } catch (error) {
    respondScenarioError(res, error, "SCENARIO_CREATE_FAILED");
  }
};


/**
 * Kiểm tra tính hợp lệ của 1 kịch bản được upload lên (body là object JSON).
 * @alias /verify
 */
exports.verifyScenario = (req, res) => {
  const messages = scenarioService.verifyScenario(req.body);
  return sendSuccess(res, 200, "Kiểm tra kịch bản thành công", messages);
};

/**
 * Kiểm tra cú pháp file .json kịch bản (body là chuỗi thô, Content-Type: text/plain).
 * Trả về lỗi/cảnh báo kèm dòng, cột và đường dẫn (path).
 * @alias /verify-file
 */
exports.verifyScenarioFile = (req, res) => {
  const raw = typeof req.body === "string" ? req.body : (req.body && req.body.content);
  const result = validateScenarioFile(raw);
  return sendSuccess(res, 200, "Kiểm tra file kịch bản thành công", result);
};

/**
 * Updates an existing scenario.
 * @alias /update/:scenarioId
 */
exports.updateScenario = async (req, res) => {
  const { scenarioId } = req.params;
  const userId = req.user.id;
  try {
    await scenarioService.updateScenario(scenarioId, userId, req.body);
    return sendSuccess(res, 202, "Đã chấp nhận cập nhật — đang đồng bộ nội dung lên Firestore.", {
      scenarioId,
      syncStatus: "pending",
    });
  } catch (error) {
    respondScenarioError(res, error, "SCENARIO_UPDATE_FAILED");
  }
};

/** Xóa một kịch bản của 1 tài khoản hiện thời
 * @alias /scenarios/:scenarioId
 */
exports.deleteScenario = async (req, res) => {
  const { scenarioId } = req.params;
  const userId = req.user.id;
  try {
    await scenarioService.deleteScenario(scenarioId, userId);
    return sendSuccess(res, 202, "Đã chấp nhận xóa — đang đồng bộ xóa trên Firestore.", {
      scenarioId,
      syncStatus: "pending",
    });
  } catch (error) {
    respondScenarioError(res, error, "SCENARIO_DELETE_FAILED");
  }
};

/**
 * Public: kiểm tra mã chia sẻ có thể mở (không trả nội dung kịch bản).
 * @alias /share/:shareCode/availability
 */
exports.getShareAvailability = async (req, res) => {
  const { shareCode } = req.params;
  try {
    const available = await scenarioService.isShareCodeAvailable(shareCode);
    if (!available) {
      return sendError(
        res,
        404,
        "Mã chia sẻ không tồn tại hoặc chưa được bật chia sẻ.",
        "SHARE_CODE_NOT_AVAILABLE"
      );
    }
    return sendSuccess(res, 200, "Mã chia sẻ có thể truy cập.", {
      available: true,
      shareCode,
    });
  } catch (error) {
    respondScenarioError(res, error, "SHARE_AVAILABILITY_FAILED");
  }
};

/**
 * Public: kịch bản theo mã chia sẻ. Field kịch bản + `message` / `trace_id` cùng cấp root (sendSuccess merge DTO).
 * @alias /share/:shareCode
 */
exports.getScenarioByShareCode = async (req, res) => {
  const { shareCode } = req.params;
  try {
    const raw = await scenarioService.getScenarioByShareCode(shareCode);
    return sendSuccess(
      res,
      200,
      "Lấy kịch bản chia sẻ thành công.",
      mapScenarioFromMaybeDataValues(raw),
      scenarioMergedResourceSuccessSchema
    );
  } catch (error) {
    respondScenarioError(res, error, "SCENARIO_SHARE_FETCH_FAILED");
  }
};

/** Lấy kịch bản dựa trên id của kịch bản, dạng text
 * @see getScenarioById()  Trả về toàn bộ kịch bản và thông tin quản lý
 * @see exportScenarioById  Trả về nội dung kịch bản, không có thông tin quản lý, ở dạng file
 * @see getScenarioByShareCode Trả về nội dung kịch bản
 * @alias /scenarios/:scenarioId
 */
exports.getScenarioById = async (req, res) => {
  const { scenarioId } = req.params;
  const userId = req.user.id;
  try {
    const record = await scenarioService.getScenarioById(scenarioId, userId);
    return sendSuccess(
      res,
      200,
      "Lấy kịch bản thành công.",
      mapScenarioOutput(record),
      scenarioMergedResourceSuccessSchema
    );
  } catch (error) {
    respondScenarioError(res, error, "SCENARIO_GET_FAILED");
  }
};

/** Lấy nội dung của kịch bản và lưu về dạng file
 * @see getScenarioById()  Trả về toàn bộ kịch bản và thông tin quản lý
 * @see exportScenarioById  Trả về nội dung kịch bản, không có thông tin quản lý, ở dạng file
 * @see getScenarioByShareCode Trả về nội dung kịch bản, không có thông tin quản lý, ở dạng json
 * @alias /scenarios/:scenarioId
 */
exports.exportScenarioById = async (req, res) => {
  const { scenarioId } = req.params;
  const userId = req.user.id;
  try {
    const record = await scenarioService.getScenarioById(scenarioId, userId);
    const scenario = mapScenarioForExport(record);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(record.Name + ".json")}`);
    return sendSuccess(res, 200, "Xuất file kịch bản thành công.", scenario, scenarioMergedResourceSuccessSchema);
  } catch (error) {
    respondScenarioError(res, error, "SCENARIO_EXPORT_FAILED");
  }
};

/** Lấy toàn bộ kịch bản của 1 tài khoản hiện thời
 * @alias /scenarios/myscenarios
 */
exports.getScenariosByUserId = async (req, res) => {
  const userId = req.user.id;
  try {
    const scenarios = await scenarioService.getScenariosByUserId(userId);
    /** Tương thích client cũ: mảng JSON thuần ở root (không có envelope). */
    if (req.query.legacy_array === "1") {
      return res.status(200).json(scenarios);
    }
    return sendSuccess(res, 200, "Lấy danh sách kịch bản thành công.", { scenarios }, scenarioListEnvelopeSchema);
  } catch (error) {
    respondScenarioError(res, error, "SCENARIO_LIST_FAILED");
  }
};

/** Kích hoạt/Tắt chia sẻ cấu hình
 * @alias /scenarios/share/:scenarioId/
 */
exports.shareScenarioById = async (req, res) => {
  const { scenarioId } = req.params;
  const userId = req.user.id;
  try {
    const scenario = await scenarioService.shareScenario(scenarioId, userId);
    if (scenario.IsShared) {
      return sendSuccess(res, 200, "Chia sẻ kịch bản thành công.", {
        message: "Chia sẻ kịch bản thành công.",
        ShareCode: scenario.ShareCode,
        IsShared: scenario.IsShared,
      });
    }
    return sendSuccess(res, 200, "Đã ngừng chia sẻ để sử dụng cá nhân.", {
      message: "Đã ngừng chia sẻ để sử dụng cá nhân.",
      IsShared: scenario.IsShared,
    });
  } catch (error) {
    respondScenarioError(res, error, "SCENARIO_TOGGLE_SHARE_FAILED");
  }
};