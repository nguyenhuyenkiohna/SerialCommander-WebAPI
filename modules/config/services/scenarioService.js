const { Scenario, sequelize } = require("../../../models");
const { v4: uuidv4 } = require("uuid");
const { logWarn, logError } = require("../../../kernels/logging/appLogger");
const scenarioFirestore = require("./scenarioFirestoreService");
const scenarioSyncQueue = require("../../../kernels/scenarioSyncQueue");
const scenarioSyncJobService = require("./scenarioSyncJobService");

function toPlainRecord(record) {
  if (!record) return null;
  return record.dataValues ? { ...record.dataValues } : { ...record };
}

function contentInputToArray(content) {
  if (Array.isArray(content)) return content;
  if (content == null || content === "") return null;
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function sanitizeString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function normalizeScenarioPayload(scenarioData) {
  const errors = [];
  const name = sanitizeString(scenarioData?.Name);
  if (!name) {
    errors.push('Trường "Name" là bắt buộc.');
  }

  const contentArr = contentInputToArray(scenarioData?.Content);
  if (!contentArr) {
    errors.push('Trường "Content" phải là JSON array hợp lệ.');
  }

  const parity = scenarioData?.Parity == null ? "none" : String(scenarioData.Parity).toLowerCase();
  if (!["none", "even", "odd", "mark", "space"].includes(parity)) {
    errors.push('Trường "Parity" không hợp lệ.');
  }

  const stopBits = scenarioData?.StopBits == null ? 1 : Number(scenarioData.StopBits);
  if (![1, 2].includes(stopBits)) {
    errors.push('Trường "StopBits" chỉ chấp nhận 1 hoặc 2.');
  }

  const dataBits = scenarioData?.DataBits == null ? 8 : Number(scenarioData.DataBits);
  if (![7, 8].includes(dataBits)) {
    errors.push('Trường "DataBits" chỉ chấp nhận 7 hoặc 8.');
  }

  const flowControl = scenarioData?.FlowControl == null ? "none" : String(scenarioData.FlowControl).toLowerCase();
  if (!["none", "hardware"].includes(flowControl)) {
    errors.push('Trường "FlowControl" chỉ chấp nhận "none" hoặc "hardware".');
  }

  const newLineRaw = scenarioData?.NewLine == null ? "none" : String(scenarioData.NewLine);
  const newLineNormalized = newLineRaw.toUpperCase() === "NONE" ? "none" : newLineRaw.toUpperCase();
  if (!["none", "CRLF", "CR", "LF"].includes(newLineNormalized)) {
    errors.push('Trường "NewLine" chỉ chấp nhận "none", "CRLF", "CR" hoặc "LF".');
  }

  const baudrate = scenarioData?.Baudrate == null ? null : Number(scenarioData.Baudrate);
  if (baudrate != null && (!Number.isInteger(baudrate) || baudrate <= 0)) {
    errors.push('Trường "Baudrate" phải là số nguyên dương.');
  }

  if (errors.length > 0) {
    const error = new Error(errors.join(" "));
    error.statusCode = 400;
    throw error;
  }

  return {
    Name: name,
    Description: sanitizeString(scenarioData?.Description, ""),
    Baudrate: baudrate,
    Parity: parity,
    StopBits: stopBits,
    DataBits: dataBits,
    FlowControl: flowControl,
    NewLine: newLineNormalized,
    Banners: Array.isArray(scenarioData?.Banners) ? scenarioData.Banners : [],
    Banner1: scenarioData?.Banner1 ?? null,
    Banner2: scenarioData?.Banner2 ?? null,
    Content: contentArr,
  };
}

/**
 * Gắn Content (chuỗi JSON mảng) từ Firestore hoặc giữ bản legacy trong MySQL.
 */
async function attachScenarioContent(record) {
  const out = toPlainRecord(record);
  if (!out) return null;
  const fromFs = await scenarioFirestore.getScenarioContentArray(out.Id);
  if (fromFs != null) {
    out.Content = JSON.stringify(fromFs);
  } else if (out.Content == null || out.Content === "") {
    out.Content = JSON.stringify([]);
  }
  return out;
}

/**
 * Verifies if the scenario data is valid — dùng cùng normalizeScenarioPayload để đảm bảo
 * contract nhất quán giữa /verify (public) và createScenario/updateScenario.
 *
 * @param {object} scenarioData - The scenario data to validate.
 * @returns {object} { data, errors, warnings }
 */
exports.verifyScenario = (scenarioData) => {
  const warnings = [];

  if (!scenarioData || typeof scenarioData !== "object") {
    return { data: null, errors: ["Dữ liệu kịch bản không hợp lệ hoặc bị thiếu."], warnings };
  }

  // Gợi ý không bắt buộc
  if (!scenarioData.Description || String(scenarioData.Description).trim() === "") {
    warnings.push('Trường "Description" giúp giải thích rõ hơn về kịch bản.');
  }

  // Kiểm tra cấu trúc Content items nếu có
  const rawContent = scenarioData.Content;
  if (rawContent) {
    try {
      const arr = Array.isArray(rawContent) ? rawContent : JSON.parse(rawContent);
      if (Array.isArray(arr)) {
        arr.forEach((item, index) => {
          if (typeof item !== "object" || item === null) return;
          if (item.List !== null && item.List !== undefined && typeof item.List !== "string") {
            warnings.push(`Trường List của Content[${index}] nên là chuỗi hoặc null.`);
          }
          if (item.DefaultValue !== null && item.DefaultValue !== undefined && typeof item.DefaultValue !== "string") {
            warnings.push(`Trường DefaultValue của Content[${index}] nên là chuỗi hoặc null.`);
          }
        });
      }
    } catch {
      // Lỗi parse sẽ được báo bởi normalizeScenarioPayload bên dưới
    }
  }

  // Dùng cùng logic validate/normalize với createScenario để đảm bảo nhất quán
  try {
    const normalized = normalizeScenarioPayload(scenarioData);
    return { data: normalized, errors: [], warnings };
  } catch (err) {
    const messages = err.message ? err.message.split(" ").filter(Boolean) : [String(err)];
    return { data: null, errors: [err.message || String(err)], warnings };
  }
};


/**
 * Creates a new scenario for a specific user.
 * @param {string} userId - The ID of the user creating the scenario.
 * @param {object} scenarioData - The data for the new scenario.
 * @returns {Promise<object>} A promise that resolves to the created scenario object.
 */
exports.createScenario = async (userId, scenarioData) => {
  const normalized = normalizeScenarioPayload(scenarioData);
  const banners = normalized.Banners;
  const tx = await sequelize.transaction();
  let newScenario;
  try {
    newScenario = await Scenario.create(
      {
        Name: normalized.Name,
        Description: normalized.Description,
        UserId: userId,
        Baudrate: normalized.Baudrate,
        Parity: normalized.Parity,
        StopBits: normalized.StopBits,
        DataBits: normalized.DataBits,
        FlowControl: normalized.FlowControl,
        NewLine: normalized.NewLine,
        Banner1: banners[0] ?? normalized.Banner1 ?? null,
        Banner2: banners[1] ?? normalized.Banner2 ?? null,
        Content: JSON.stringify(normalized.Content),
      },
      { transaction: tx }
    );
    await scenarioSyncJobService.enqueue(
      "scenario_upsert",
      newScenario.Id,
      { content: normalized.Content },
      null,
      { transaction: tx }
    );
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    logError("createScenario failed", {
      userId,
      message: error.message || String(error),
      code: error.code,
      statusCode: error.statusCode || error.status,
    });
    throw error;
  }

  const plain = toPlainRecord(newScenario);
  plain.Content = JSON.stringify(normalized.Content);
  plain.syncStatus = "pending";
  return plain;
};

/**
 * Tìm kịch bản dựa trên tham số
 * @param {string} id - ID của kịch bản
 * @param {string} userId - Id của người sở hữu
 * @returns {Promise<object>} Toàn bộ bản ghi về Kịch bản trong DB
 */
exports.getScenarioById = async (id, userId) => {
  const scenario = await Scenario.findOne({
    where: { Id: id, UserId: userId },
  });
  if (!scenario) {
    const error = new Error("Không tìm thấy kịch bản hoặc không có quyền truy cập.");
    error.statusCode = 404;
    throw error;
  }
  return attachScenarioContent(scenario);
};

/**
 * Updates an existing scenario.
 * @param {string} scenarioId - The ID of the scenario to update.
 * @param {string} userId - The ID of the user who owns the scenario.
 * @param {object} updateData - The data to update the scenario with.
 * @returns {Promise<number>} A promise that resolves to the number of updated rows.
 */
exports.updateScenario = async (scenarioId, userId, updateData) => {
  const normalized = normalizeScenarioPayload(updateData);
  const banners = normalized.Banners;
  const existing = await Scenario.findOne({ where: { Id: scenarioId, UserId: userId } });
  if (!existing) {
    const error = new Error("Không tìm thấy kịch bản để cập nhật hoặc không có quyền.");
    error.statusCode = 404;
    throw error;
  }

  const nextValues = {
    Name: normalized.Name,
    Description: normalized.Description,
    UserId: userId,
    Baudrate: normalized.Baudrate,
    Parity: normalized.Parity,
    StopBits: normalized.StopBits,
    DataBits: normalized.DataBits,
    FlowControl: normalized.FlowControl,
    NewLine: normalized.NewLine,
    Banner1: banners[0] ?? normalized.Banner1 ?? null,
    Banner2: banners[1] ?? normalized.Banner2 ?? null,
    Content: JSON.stringify(normalized.Content),
  };

  const tx = await sequelize.transaction();
  try {
    await Scenario.update(nextValues, {
      where: { Id: scenarioId, UserId: userId },
      transaction: tx,
    });
    await scenarioSyncJobService.enqueue(
      "scenario_upsert",
      scenarioId,
      { content: normalized.Content },
      null,
      { transaction: tx }
    );
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }

  return 1;
};

/**
 * Xóa một kịch bản
 * @param {string} id - The ID of the scenario to delete.
 * @param {string} userId - The ID of the user who owns the scenario.
 * @returns {Promise<number>} A promise that resolves to the number of deleted rows.
 */
exports.deleteScenario = async (id, userId) => {
  const tx = await sequelize.transaction();
  let deletedRows = 0;
  try {
    deletedRows = await Scenario.destroy({
      where: { Id: id, UserId: userId },
      transaction: tx,
    });
    if (deletedRows === 0) {
      const error = new Error("Không tìm thấy kịch bản để xóa hoặc không có quyền.");
      error.statusCode = 404;
      throw error;
    }
    await scenarioSyncJobService.enqueue(
      "scenario_delete",
      id,
      null,
      null,
      { transaction: tx }
    );
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }

  return deletedRows;
};

/**
 * Retrieves all scenarios belonging to a specific user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of scenario objects.
 */
exports.getScenariosByUserId = async (userId) => {
  const rows = await Scenario.findAll({
    where: { UserId: userId },
    order: [['CreatedAt', 'DESC']],
  });
  return Promise.all(rows.map((row) => attachScenarioContent(row)));
};


/**
 * Creates a new share code.
 * @returns {string} The generated share code.
 */
function generateShareCode() {
  return uuidv4().replace(/-/g, "").slice(0, 8);
}

/**
 * Kích hoat hoặc Ngừng quá trình chia sẻ cấu hình
 * @param {string} id - The ID of the scenario.
 * @param {string} userId - The ID of the user who owns the scenario.
 * @returns {Promise<object>} A promise that resolves to the updated scenario object with a share code.
 */
exports.shareScenario = async (id, userId) => {
  const scenario = await Scenario.findOne({
    where: { Id: id, UserId: userId }
  });
  if (!scenario) {
    const error = new Error("Không tìm thấy kịch bản hoặc không có quyền.");
    error.statusCode = 404;
    throw error;
  }
  scenario.IsShared = !scenario.IsShared;
  if (scenario.IsShared && !scenario.ShareCode) {
    let assigned = false;
    for (let i = 0; i < 5; i += 1) {
      try {
        scenario.ShareCode = generateShareCode();
        await scenario.save();
        assigned = true;
        break;
      } catch (error) {
        if (error.name !== "SequelizeUniqueConstraintError" && error.original?.code !== "ER_DUP_ENTRY") {
          throw error;
        }
      }
    }
    if (!assigned) {
      const error = new Error("Không thể tạo mã chia sẻ duy nhất. Vui lòng thử lại.");
      error.statusCode = 503;
      throw error;
    }
    return scenario;
  }
  await scenario.save();
  return scenario;
};

/**
 * Kiểm tra mã chia sẻ có tồn tại và đang bật IsShared (không tải Content).
 * @param {string} shareCode
 * @returns {Promise<boolean>}
 */
exports.isShareCodeAvailable = async (shareCode) => {
  const row = await Scenario.findOne({
    where: { ShareCode: shareCode, IsShared: true },
    attributes: ["Id"],
  });
  return !!row;
};

/**
 * Retrieves a scenario by its share code.
 * @param {string} shareCode - The share code of the scenario.
 * @returns {Promise<object>} A promise that resolves to the shared scenario object.
 */
exports.getScenarioByShareCode = async (shareCode) => {
  const scenario = await Scenario.findOne({
    where: { ShareCode: shareCode, IsShared: true },
    attributes: [
      "Id",
      "Name",
      "Description",
      "IsShared",
      "ShareCode",
      "Baudrate",
      "DataBits",
      "Parity",
      "StopBits",
      "NewLine",
      "FlowControl",
      "Banner1",
      "Banner2",
      "Content",
    ],
  });
  if (!scenario) {
    const error = new Error(`Không tìm thấy kịch bản chia sẻ với mã ${shareCode}.`);
    error.statusCode = 404;
    throw error;
  }
  const enriched = await attachScenarioContent(scenario);
  return { dataValues: enriched };
};
