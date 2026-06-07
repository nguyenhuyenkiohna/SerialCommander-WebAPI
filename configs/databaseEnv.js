function productionDbKeysPresent() {
  const host = process.env.PROD_DB_HOSTNAME || process.env.DATABASE_HOST;
  const name = process.env.PROD_DB_NAME || process.env.DATABASE_NAME;
  const user = process.env.PROD_DB_USERNAME || process.env.DATABASE_USERNAME;
  const pass = process.env.PROD_DB_PASSWORD || process.env.DATABASE_PASSWORD;
  return [host, name, user, pass].every((v) => v && String(v).trim() !== "");
}

function requiredKeysByEnv() {
  const dbEnv = process.env.DATABASE_ENV || "development";
  if (dbEnv === "production") {
    return productionDbKeysPresent()
      ? []
      : [
          "DATABASE_HOST hoặc PROD_DB_HOSTNAME",
          "DATABASE_NAME hoặc PROD_DB_NAME",
          "DATABASE_USERNAME hoặc PROD_DB_USERNAME",
          "DATABASE_PASSWORD hoặc PROD_DB_PASSWORD",
        ];
  }
  if (dbEnv === "test") {
    return ["DATABASE_TEST_NAME", "DATABASE_TEST_USERNAME", "DATABASE_TEST_PASSWORD"];
  }
  return ["DATABASE_HOST", "DATABASE_NAME", "DATABASE_USERNAME", "DATABASE_PASSWORD"];
}

function assertDatabaseEnvLoaded() {
  const dbEnv = process.env.DATABASE_ENV || "development";
  if (dbEnv === "production") {
    if (!productionDbKeysPresent()) {
      throw new Error(
        "[db] Thiếu cấu hình DB production: đặt DATABASE_HOST/NAME/USERNAME/PASSWORD hoặc PROD_DB_* trong .env"
      );
    }
    return;
  }

  const keys = requiredKeysByEnv();
  const missing = keys.filter((k) => {
    const v = process.env[k];
    return !v || String(v).trim() === "";
  });
  if (missing.length > 0) {
    throw new Error(`[db] Thiếu biến môi trường bắt buộc: ${missing.join(", ")}`);
  }
}

module.exports = { assertDatabaseEnvLoaded };
