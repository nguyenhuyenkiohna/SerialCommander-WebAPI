const { QueryTypes } = require("sequelize");
const { EXPECTED_SCHEMA_VERSION } = require("../config/schemaRegistry");

/**
 * So khớp schema_version trong DB với mã nguồn (bảng app_schema_registry).
 */
async function checkSchemaVersion(sequelize) {
  const isProd = process.env.NODE_ENV === "production";

  try {
    const rows = await sequelize.query(
      "SELECT schema_version AS v FROM app_schema_registry WHERE singleton_id = 1 LIMIT 1",
      { type: QueryTypes.SELECT }
    );

    const row = rows && rows[0];
    if (!row || row.v === undefined || row.v === null) {
      console.warn(
        "[db] app_schema_registry trống hoặc thiếu dòng singleton_id=1 — chạy migrations/0000_app_schema_registry.sql"
      );
      return { ok: false, reason: "empty_registry" };
    }

    const dbVersion = Number(row.v);
    if (!Number.isFinite(dbVersion)) {
      console.warn("[db] schema_version không hợp lệ trong DB.");
      return { ok: false, reason: "invalid_version" };
    }

    if (dbVersion < EXPECTED_SCHEMA_VERSION) {
      const msg = `[db] Schema DB (${dbVersion}) lệch mã nguồn (yêu cầu >= ${EXPECTED_SCHEMA_VERSION}). Chạy migration SQL rồi cập nhật app_schema_registry.`;
      console.error(msg);
      if (isProd) {
        process.exit(1);
      }
      return { ok: false, reason: "behind", dbVersion };
    }

    if (dbVersion > EXPECTED_SCHEMA_VERSION) {
      console.warn(
        `[db] Schema DB (${dbVersion}) mới hơn mã nguồn (${EXPECTED_SCHEMA_VERSION}). Kiểm tra phiên bản deploy.`
      );
    } else {
      console.log(`[db] Schema registry OK (version ${dbVersion}).`);
    }

    return { ok: true, dbVersion };
  } catch (e) {
    const msg = e?.parent?.sqlMessage || e?.message || String(e);
    if (/doesn't exist|Unknown table|1146|ER_NO_SUCH_TABLE/i.test(msg)) {
      console.warn(
        "[db] Chưa có bảng app_schema_registry — chạy migrations/0000_app_schema_registry.sql trên MySQL để bật kiểm tra phiên bản schema."
      );
      return { ok: false, reason: "no_registry_table" };
    }
    console.warn("[db] Không kiểm tra được schema_version:", msg);
    return { ok: false, reason: "query_error" };
  }
}

module.exports = { checkSchemaVersion };
