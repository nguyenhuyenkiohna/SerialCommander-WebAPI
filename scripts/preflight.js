#!/usr/bin/env node
/* eslint-disable no-console */
const path = require("path");

async function run() {
  const { loadEnvFiles } = require("../configs/bootstrapEnv");
  const { envFile, secretsEnv, layered } = loadEnvFiles();

  require("rootpath")();
  const { assertRequiredSecretsLoaded } = require("../configs/envSecrets");
  const { assertDatabaseEnvLoaded } = require("../configs/databaseEnv");
  const { sequelize } = require("../models");
  const { checkSchemaVersion } = require("../kernels/dbSchemaCheck");

  assertRequiredSecretsLoaded();
  assertDatabaseEnvLoaded();
  await sequelize.authenticate();
  const schema = await checkSchemaVersion(sequelize);
  if (!schema || schema.ok !== true) {
    const reason = schema?.reason || "unknown";
    throw new Error(`[preflight] DB schema check failed: ${reason}`);
  }

  await sequelize.close();
  const envLabel = layered && secretsEnv
    ? `${path.basename(envFile)}+secrets`
    : path.basename(envFile);
  console.log(`[preflight] OK env=${envLabel} schemaVersion=${schema.dbVersion}`);
}

run().catch((error) => {
  console.error("[preflight] FAILED:", error.message);
  process.exit(1);
});
