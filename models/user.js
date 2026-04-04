module.exports = (sequelize, DataTypes) => {
  // Định nghĩa model 'User' sử dụng sequelize.
  // 'sequelize' là instance kết nối đến database.
  // 'DataTypes' chứa các kiểu dữ liệu có sẵn trong Sequelize (ví dụ: STRING, INTEGER, ENUM).
  const User = sequelize.define("User", {
    // Định nghĩa cột 'username'
    username: { type: DataTypes.STRING, unique: false, allowNull: true }, // unique: false to avoid "too many keys" error
    password: { type: DataTypes.STRING, allowNull: true },
    // Định nghĩa cột 'email'
    email: { type: DataTypes.STRING, unique: true, allowNull: false },
    // Định nghĩa cột 'role' (vai trò của người dùng)
    role: { type: DataTypes.ENUM("admin", "user"), defaultValue: "user" },
    // Google OAuth fields
    googleId: { type: DataTypes.STRING, unique: false, allowNull: true }, // unique: false to avoid "too many keys" error
    provider: { type: DataTypes.ENUM("local", "google"), defaultValue: "local" },
    // Local account phải xác thực email trước khi đăng nhập
    isVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
    });

  // Định nghĩa mối quan hệ giữa các models. Thiết lập quan hệ 1-n
  User.associate = (models) => {
    // Một User có nhiều DeviceConfig (một người dùng có thể sở hữu nhiều cấu hình thiết bị).
    // 'models.DeviceConfig' là model 'DeviceConfig' đã được định nghĩa ở nơi khác.
    // 'foreignKey: "userId"' chỉ ra rằng cột 'userId' trong bảng 'DeviceConfig' sẽ là khóa ngoại liên kết với 'User'.
    User.hasMany(models.Scenario, {
      foreignKey: "UserId",
    });
    // Một User có nhiều UserActivity (lịch sử hoạt động)
    if (models.UserActivity) {
      User.hasMany(models.UserActivity, {
        foreignKey: "UserId",
        as: 'activities'
      });
    }
  };

  // Trả về model User đã được định nghĩa
  return User;
};