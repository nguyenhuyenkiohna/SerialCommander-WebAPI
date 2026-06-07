/**
 * `npm test` — unit tests không cần DB (auth, middleware).
 * Threshold: global nhẹ + các path lõi có thêm chỉ tiêu.
 */
module.exports = {
  testEnvironment: "node",
  moduleDirectories: ["node_modules", "<rootDir>"],
  modulePaths: ["<rootDir>"],
  roots: ["<rootDir>"],
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.js", "<rootDir>/modules/**/*.test.js"],
  collectCoverageFrom: [
    "modules/**/*.js",
    "routes/**/*.js",
    "kernels/**/*.js",
    "configs/**/*.js",
    "!**/*.test.js",
    "!kernels/tests/**",
  ],
  coverageThreshold: {
    global: {
      branches: 31,
      functions: 40,
      lines: 41,
      statements: 41,
    },
    "modules/auth/**/*.js": {
      branches: 55,
      functions: 64,
      lines: 68,
      statements: 68,
    },
    "modules/auth/services/**/*.js": {
      branches: 53,
      functions: 75,
      lines: 70,
      statements: 69,
    },
    "modules/config/services/scenarioSyncJobService.js": {
      branches: 40,
      functions: 80,
      lines: 75,
      statements: 75,
    },
    "kernels/middlewares/authMiddleware.js": {
      branches: 85,
      functions: 100,
      lines: 90,
      statements: 90,
    },
    "kernels/middlewares/requestTraceMiddleware.js": {
      branches: 75,
      functions: 100,
      lines: 85,
      statements: 85,
    },
  },
  testTimeout: 15000,
};
