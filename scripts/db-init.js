#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Tạo bảng Sequelize lần đầu (DB Docker trống) trước khi chạy migrations/*.sql
 */
require("../configs/bootstrapEnv");
require("rootpath")();

const { assertDatabaseEnvLoaded } = require("../configs/databaseEnv");
const { sequelize } = require("../models");

async function run() {
  assertDatabaseEnvLoaded();
  await sequelize.authenticate();
  console.log("[db-init] Connected — running sequelize.sync({ alter: false })");
  await sequelize.sync({ alter: false });
  await sequelize.close();
  console.log("[db-init] OK — tiếp theo: make migrate && make preflight");
}

run().catch((err) => {
  console.error("[db-init] FAILED:", err.message);
  process.exit(1);
});
