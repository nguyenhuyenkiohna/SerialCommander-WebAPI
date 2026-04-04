/**
 * Jest config cho Unit Tests (không cần database thật, dùng mock).
 * Chạy: npm run test:unit
 */
module.exports = {
  testEnvironment: "node",
  moduleDirectories: ["node_modules", "<rootDir>"],
  modulePaths: ["<rootDir>"],
  roots: ["<rootDir>"],
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  testTimeout: 15000,
  // Không có globalSetup/globalTeardown vì không cần DB thật
};
