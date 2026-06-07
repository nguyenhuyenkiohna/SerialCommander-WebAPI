// NOTE: dotenv is loaded centrally in index.js with the correct env file path.
// Do NOT call require("dotenv").config() here — it would load the wrong file.

function productionDbConfig() {
  return {
    username: process.env.PROD_DB_USERNAME || process.env.DATABASE_USERNAME,
    password: process.env.PROD_DB_PASSWORD || process.env.DATABASE_PASSWORD,
    database: process.env.PROD_DB_NAME || process.env.DATABASE_NAME,
    host: process.env.PROD_DB_HOSTNAME || process.env.DATABASE_HOST,
    port: process.env.PROD_DB_PORT || process.env.DATABASE_PORT || 3306,
    dialect: "mysql",
    dialectOptions: {
      bigNumberStrings: true,
    },
  };
}

module.exports = {
  environment: process.env.DATABASE_ENV || "development",
  development: {
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT || 3306,
    dialect: "mysql",
    dialectOptions: {
      bigNumberStrings: true,
    },
    logging: process.env.DEBUG === "true" ? console.log : false,
  },
  test: {
    username: process.env.DATABASE_TEST_USERNAME,
    password: process.env.DATABASE_TEST_PASSWORD,
    database: process.env.DATABASE_TEST_NAME,
    host: process.env.DATABASE_TEST_HOST || "127.0.0.1",
    port: process.env.DATABASE_TEST_PORT || 3306,
    dialect: "mysql",
    dialectOptions: {
      bigNumberStrings: true,
      charset: "utf8mb4",
    },
  },
  production: productionDbConfig(),
};
