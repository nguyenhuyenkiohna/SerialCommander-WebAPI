module.exports = (sequelize, DataTypes) => {
  const PendingRegistration = sequelize.define("PendingRegistration", {
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    verifyCode: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  });

  return PendingRegistration;
};
