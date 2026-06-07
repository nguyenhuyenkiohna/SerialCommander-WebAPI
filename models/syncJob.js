const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const syncJob = sequelize.define(
    "SyncJob",
    {
      Id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      OperationType: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      OperationKey: {
        type: DataTypes.STRING(191),
        allowNull: false,
        unique: true,
      },
      ScenarioId: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      Payload: {
        type: DataTypes.TEXT("long"),
        allowNull: true,
      },
      Status: {
        type: DataTypes.ENUM("pending", "processing", "success", "failed"),
        allowNull: false,
        defaultValue: "pending",
      },
      WorkerId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        defaultValue: null,
      },
      RetryCount: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      MaxRetries: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 10,
      },
      NextRetryAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      LastError: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      CreatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      ModifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "SyncJobs",
      timestamps: false,
      charset: "utf8mb4",
      collate: "utf8mb4_0900_ai_ci",
    }
  );

  return syncJob;
};
