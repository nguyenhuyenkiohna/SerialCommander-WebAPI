/**
 * Quy ước đặt tên cột DB (legacy, không đổi schema production):
 *
 * - Scenarios: PascalCase (Id, UserId, Name, Content, …) — schema gốc Sequelize ban đầu
 * - Users: camelCase (username, email, googleId, …) — schema bổ sung sau
 *
 * API layer chuẩn hóa qua scenarioPresenter; không rename cột DB để tránh migration breaking.
 */
module.exports = {
  SCENARIO_TABLE: "Scenarios",
  SCENARIO_PK: "Id",
  USER_TABLE: "Users",
  USER_PK: "id",
  NAMING_CONVENTION: {
    scenarios: "PascalCase",
    users: "camelCase",
  },
};
