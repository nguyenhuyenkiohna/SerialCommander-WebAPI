/**
 * Load env sớm (server + telemetry trước khi require index/Express).
 * - production: chỉ `.env`
 * - development: `.env` (base, ví dụ GMAIL_*) rồi `.env.local` ghi đè (DB local, PORT, …)
 */

const path = require("path");

const projectRoot = path.join(__dirname, "..");

function resolveEnvFilePath() {
  if (process.env.ENV_FILE) {
    return process.env.ENV_FILE;
  }
  if (process.env.NODE_ENV === "production") {
    return path.join(projectRoot, ".env");
  }
  return path.join(projectRoot, ".env.local");
}

function loadEnvFiles() {
  if (process.env.ENV_FILE) {
    require("dotenv").config({ path: process.env.ENV_FILE });
    return { envFile: process.env.ENV_FILE, layered: false };
  }

  const baseEnv = path.join(projectRoot, ".env");
  const localEnv = path.join(projectRoot, ".env.local");

  if (process.env.NODE_ENV === "production") {
    require("dotenv").config({ path: baseEnv });
    return { envFile: baseEnv, layered: false };
  }

  require("dotenv").config({ path: baseEnv });
  require("dotenv").config({ path: localEnv, override: true });
  return { envFile: localEnv, baseEnv, layered: true };
}

const loadResult = loadEnvFiles();

module.exports = {
  resolveEnvFilePath,
  envFile: loadResult.envFile,
  loadEnvFiles,
  loadResult,
};
