module.exports = (sequelize, DataTypes) => {
  const EmailVerificationCode = sequelize.define("EmailVerificationCode", {
    UserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "FK to Users.id",
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isEmail: true,
      },
    },
    verifyCode: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    used: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  });

  EmailVerificationCode.associate = (models) => {
    if (models.User) {
      EmailVerificationCode.belongsTo(models.User, {
        foreignKey: "UserId",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      });
    }
  };

  return EmailVerificationCode;
};
