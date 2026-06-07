#!/usr/bin/env node
/* eslint-disable no-console */
const path = require("path");
const dotenv = require("dotenv");

function resolveEnvFilePath() {
  if (process.env.ENV_FILE) return process.env.ENV_FILE;
  if (process.env.NODE_ENV === "production") return ".env";
  return ".env.local";
}

async function run() {
  const envFile = resolveEnvFilePath();
  dotenv.config({ path: envFile });

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
  console.log(`[preflight] OK env=${path.basename(envFile)} schemaVersion=${schema.dbVersion}`);
}

run().catch((error) => {
  console.error("[preflight] FAILED:", error.message);
  process.exit(1);
});
