"use strict";

const jsonMap = require("json-source-map");

/**
 * Các kiểu khối Content hợp lệ (đồng bộ với frontend SerialAction BlockType).
 */
/** Canonical block types (ưu tiên chính tả đúng). */
const VALID_CONTENT_TYPES = [
  "text", "dropdown", "para", "button", "button2",
  "5directions", "slider", "slider2", "toggle", "toggle2",
  "var", "knob", "colorpicker", "numberinput", "joystick",
  "matrix", "gauge", "progress", "chart",
  // Legacy typo — vẫn chấp nhận, chuẩn hóa sang toggle* + cảnh báo
  "toogle", "toogle2",
];

/** Alias cũ → canonical (đồng bộ SerialAction BlockType). */
const CONTENT_TYPE_ALIASES = {
  toogle: "toggle",
  toogle2: "toggle2",
};

const DEPRECATED_TYPE_WARNINGS = {
  toogle: 'Type "toogle" đã lỗi thời — dùng "toggle".',
  toogle2: 'Type "toogle2" đã lỗi thời — dùng "toggle2".',
};

/**
 * Lấy dòng/cột từ vị trí ký tự trong chuỗi (1-based).
 * @param {string} raw - Chuỗi JSON gốc
 * @param {number} pos - Vị trí ký tự (0-based)
 * @returns {{ line: number, column: number }}
 */
function positionToLineColumn(raw, pos) {
  const before = raw.slice(0, Math.max(0, pos));
  const lines = before.split(/\r\n|\r|\n/);
  const line = lines.length;
  const column = lines[lines.length - 1].length;
  return { line, column };
}

/**
 * Trích vị trí (line/column) từ thông báo lỗi SyntaxError của JSON.parse.
 * @param {string} raw - Chuỗi JSON gốc
 * @param {Error} err - Lỗi từ JSON.parse
 * @returns {{ line: number, column: number } | null}
 */
function getSyntaxErrorPosition(raw, err) {
  const msg = err && err.message;
  if (!msg) return null;
  const m = msg.match(/position\s+(\d+)/i);
  if (m) {
    const pos = parseInt(m[1], 10);
    return positionToLineColumn(raw, pos);
  }
  return null;
}

/**
 * Chuyển đường dẫn dạng "Content[2].Type" thành JSON pointer "/Content/2/Type".
 * @param {string} path - Đường dẫn kiểu Content[2].Type hoặc Name
 * @returns {string}
 */
function pathToJsonPointer(path) {
  if (!path) return "";
  return "/" + path
    .replace(/\./g, "/")
    .replace(/\[(\d+)\]/g, "/$1")
    .replace(/^\/+/, "");
}

/**
 * Lấy vị trí (dòng, cột) cho một đường dẫn từ bản đồ pointers của json-source-map.
 * pointers[ptr] có dạng { value: { line, column, pos }, valueEnd, key, keyEnd }.
 * Line/column trong thư viện là 0-based, trả về 1-based cho người dùng.
 * @param {object} pointers - pointers từ jsonMap.parse()
 * @param {string} jsonPointer - Ví dụ "/Content/2/Type"
 * @returns {{ line: number, column: number } | null}
 */
function getPositionForPath(pointers, jsonPointer) {
  const entry = pointers[jsonPointer];
  if (!entry || !entry.value) return null;
  const { line, column } = entry.value;
  return {
    line: typeof line === "number" ? line + 1 : 1,
    column: typeof column === "number" ? column + 1 : 1
  };
}

/**
 * Kiểm tra cấu trúc từng phần tử Content và thu thập lỗi/cảnh báo.
 * @param {Array} content - Mảng Content đã parse
 * @param {object} pointers - Bản đồ vị trí từ jsonMap.parse()
 * @returns {{ errors: Array<{message, path, line, column}>, warnings: Array }}
 */
function validateContentArray(content, pointers) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(content)) {
    return {
      errors: [{ message: "Content phải là một mảng.", path: "Content", line: null, column: null }],
      warnings
    };
  }

  content.forEach((item, index) => {
    const basePath = `Content[${index}]`;
    const basePointer = `/Content/${index}`;

    if (item === null || typeof item !== "object") {
      const loc = getPositionForPath(pointers, basePointer);
      errors.push({
        message: `Phần tử ${basePath} không phải là một đối tượng.`,
        path: basePath,
        line: loc ? loc.line : null,
        column: loc ? loc.column : null
      });
      return;
    }

    // Type (bắt buộc, enum)
    if (item.Type === undefined || item.Type === null) {
      const ptr = `${basePointer}/Type`;
      const loc = getPositionForPath(pointers, ptr);
      errors.push({
        message: `Trường "Type" của ${basePath} thiếu hoặc không hợp lệ.`,
        path: `${basePath}.Type`,
        line: loc ? loc.line : null,
        column: loc ? loc.column : null
      });
    } else if (typeof item.Type !== "string" || item.Type.trim() === "") {
      const ptr = `${basePointer}/Type`;
      const loc = getPositionForPath(pointers, ptr);
      errors.push({
        message: `Trường "Type" của ${basePath} phải là chuỗi không rỗng.`,
        path: `${basePath}.Type`,
        line: loc ? loc.line : null,
        column: loc ? loc.column : null
      });
    } else {
      const rawType = item.Type;
      const alias = CONTENT_TYPE_ALIASES[rawType];
      if (alias) {
        item.Type = alias;
        const ptr = `${basePointer}/Type`;
        const loc = getPositionForPath(pointers, ptr);
        warnings.push({
          message: DEPRECATED_TYPE_WARNINGS[rawType] || `Type "${rawType}" đã được chuẩn hóa thành "${alias}".`,
          path: `${basePath}.Type`,
          line: loc ? loc.line : null,
          column: loc ? loc.column : null
        });
      } else if (!VALID_CONTENT_TYPES.includes(rawType)) {
        const ptr = `${basePointer}/Type`;
        const loc = getPositionForPath(pointers, ptr);
        const canonicalList = [...new Set([...VALID_CONTENT_TYPES, ...Object.keys(CONTENT_TYPE_ALIASES)])];
        errors.push({
          message: `"Type" của ${basePath} không hợp lệ. Giá trị hợp lệ: ${canonicalList.join(", ")}.`,
          path: `${basePath}.Type`,
          line: loc ? loc.line : null,
          column: loc ? loc.column : null
        });
      }
    }

    // Name (bắt buộc)
    if (item.Name === undefined || item.Name === null) {
      const ptr = `${basePointer}/Name`;
      const loc = getPositionForPath(pointers, ptr);
      errors.push({
        message: `Trường "Name" của ${basePath} thiếu.`,
        path: `${basePath}.Name`,
        line: loc ? loc.line : null,
        column: loc ? loc.column : null
      });
    } else if (typeof item.Name !== "string" || item.Name.trim() === "") {
      const ptr = `${basePointer}/Name`;
      const loc = getPositionForPath(pointers, ptr);
      errors.push({
        message: `Trường "Name" của ${basePath} phải là chuỗi không rỗng.`,
        path: `${basePath}.Name`,
        line: loc ? loc.line : null,
        column: loc ? loc.column : null
      });
    }

    // Labels: nên là mảng chuỗi
    if (item.Labels !== undefined && item.Labels !== null && !Array.isArray(item.Labels)) {
      const ptr = `${basePointer}/Labels`;
      const loc = getPositionForPath(pointers, ptr);
      warnings.push({
        message: `Trường "Labels" của ${basePath} nên là mảng.`,
        path: `${basePath}.Labels`,
        line: loc ? loc.line : null,
        column: loc ? loc.column : null
      });
    }

    // TxFormats: nên là mảng chuỗi
    if (item.TxFormats !== undefined && item.TxFormats !== null && !Array.isArray(item.TxFormats)) {
      const ptr = `${basePointer}/TxFormats`;
      const loc = getPositionForPath(pointers, ptr);
      warnings.push({
        message: `Trường "TxFormats" của ${basePath} nên là mảng.`,
        path: `${basePath}.TxFormats`,
        line: loc ? loc.line : null,
        column: loc ? loc.column : null
      });
    }

    // Params: null hoặc mảng đối tượng
    if (item.Params !== undefined && item.Params !== null && !Array.isArray(item.Params)) {
      const ptr = `${basePointer}/Params`;
      const loc = getPositionForPath(pointers, ptr);
      warnings.push({
        message: `Trường "Params" của ${basePath} nên là mảng hoặc null.`,
        path: `${basePath}.Params`,
        line: loc ? loc.line : null,
        column: loc ? loc.column : null
      });
    }
  });

  return { errors, warnings };
}

/**
 * Kiểm tra file JSON kịch bản (chuỗi thô) và trả về lỗi/cảnh báo kèm vị trí dòng, cột.
 * @param {string} rawJson - Nội dung file .json dạng chuỗi
 * @returns {{
 *   valid: boolean,
 *   errors: Array<{ message: string, path: string | null, line: number | null, column: number | null }>,
 *   warnings: Array<{ message: string, path: string | null, line: number | null, column: number | null }>
 * }}
 */
function validateScenarioFile(rawJson) {
  const errors = [];
  const warnings = [];

  if (typeof rawJson !== "string") {
    return {
      valid: false,
      errors: [{ message: "Đầu vào phải là chuỗi JSON (nội dung file).", path: null, line: null, column: null }],
      warnings: []
    };
  }

  const trimmed = rawJson.trim();
  if (trimmed === "") {
    return {
      valid: false,
      errors: [{ message: "File trống hoặc không có nội dung.", path: null, line: null, column: null }],
      warnings: []
    };
  }

  let data;
  let pointers = {};

  try {
    const parsed = jsonMap.parse(trimmed);
    data = parsed.data;
    pointers = parsed.pointers || {};
  } catch (parseErr) {
    const loc = getSyntaxErrorPosition(trimmed, parseErr);
    return {
      valid: false,
      errors: [{
        message: parseErr && parseErr.message ? parseErr.message : "Lỗi cú pháp JSON.",
        path: null,
        line: loc ? loc.line : null,
        column: loc ? loc.column : null
      }],
      warnings: []
    };
  }

  if (!data || typeof data !== "object") {
    const loc = getPositionForPath(pointers, "");
    return {
      valid: false,
      errors: [{
        message: "Gốc phải là một đối tượng JSON.",
        path: null,
        line: loc ? loc.line : 1,
        column: loc ? loc.column : 1
      }],
      warnings: []
    };
  }

  // --- Root: Name (bắt buộc)
  if (!data.Name || typeof data.Name !== "string" || data.Name.trim() === "") {
    const ptr = "/Name";
    const loc = getPositionForPath(pointers, ptr);
    errors.push({
      message: "Trường \"Name\" (tên kịch bản) bắt buộc và phải là chuỗi không rỗng.",
      path: "Name",
      line: loc ? loc.line : null,
      column: loc ? loc.column : null
    });
  }

  // --- Description (tùy chọn, khuyến nghị)
  if (data.Description !== undefined && data.Description !== null && typeof data.Description !== "string") {
    const ptr = "/Description";
    const loc = getPositionForPath(pointers, ptr);
    warnings.push({
      message: "Trường \"Description\" nên là chuỗi.",
      path: "Description",
      line: loc ? loc.line : null,
      column: loc ? loc.column : null
    });
  }

  // --- Content (bắt buộc, mảng)
  if (data.Content === undefined || data.Content === null) {
    const ptr = "/Content";
    const loc = getPositionForPath(pointers, ptr);
    errors.push({
      message: "Trường \"Content\" (danh sách khối lệnh) bắt buộc.",
      path: "Content",
      line: loc ? loc.line : null,
      column: loc ? loc.column : null
    });
  } else {
    const contentResult = validateContentArray(data.Content, pointers);
    errors.push(...contentResult.errors);
    warnings.push(...contentResult.warnings);
  }

  // --- Banners (tùy chọn): nên là mảng chuỗi
  if (data.Banners !== undefined && data.Banners !== null && !Array.isArray(data.Banners)) {
    const ptr = "/Banners";
    const loc = getPositionForPath(pointers, ptr);
    warnings.push({
      message: "Trường \"Banners\" nên là mảng chuỗi.",
      path: "Banners",
      line: loc ? loc.line : null,
      column: loc ? loc.column : null
    });
  }

  // --- Baudrate, Parity, StopBits, DataBits, NewLine, FlowControl: kiểu đúng
  if (data.Baudrate !== undefined && data.Baudrate !== null && typeof data.Baudrate !== "number") {
    const ptr = "/Baudrate";
    const loc = getPositionForPath(pointers, ptr);
    warnings.push({
      message: "Trường \"Baudrate\" nên là số.",
      path: "Baudrate",
      line: loc ? loc.line : null,
      column: loc ? loc.column : null
    });
  }

  const validParities = ["none", "even", "odd", "mark", "space"];
  if (data.Parity !== undefined && data.Parity !== null && typeof data.Parity === "string" && !validParities.includes(data.Parity.toLowerCase())) {
    const ptr = "/Parity";
    const loc = getPositionForPath(pointers, ptr);
    warnings.push({
      message: `Trường "Parity" nên là một trong: ${validParities.join(", ")}.`,
      path: "Parity",
      line: loc ? loc.line : null,
      column: loc ? loc.column : null
    });
  }

  const validStopBits = [1, 1.5, 2];
  if (data.StopBits !== undefined && data.StopBits !== null && !validStopBits.includes(data.StopBits)) {
    const ptr = "/StopBits";
    const loc = getPositionForPath(pointers, ptr);
    warnings.push({
      message: `Trường "StopBits" nên là 1, 1.5 hoặc 2.`,
      path: "StopBits",
      line: loc ? loc.line : null,
      column: loc ? loc.column : null
    });
  }

  if (data.DataBits !== undefined && data.DataBits !== null && (typeof data.DataBits !== "number" || (data.DataBits !== 7 && data.DataBits !== 8))) {
    const ptr = "/DataBits";
    const loc = getPositionForPath(pointers, ptr);
    warnings.push({
      message: "Trường \"DataBits\" nên là 7 hoặc 8.",
      path: "DataBits",
      line: loc ? loc.line : null,
      column: loc ? loc.column : null
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

module.exports = {
  validateScenarioFile,
  VALID_CONTENT_TYPES,
  positionToLineColumn,
  getSyntaxErrorPosition
};
