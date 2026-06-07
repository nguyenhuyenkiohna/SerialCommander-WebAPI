const { User } = require("../../../models");
const UserActivityService = require("./userActivityService");
const { validateUsername } = require("../../../utils/usernameValidation");

function createAppError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function updateUserProfile(userId, { username }) {
  if (!userId) {
    throw createAppError(401, "UNAUTHORIZED", "Cần đăng nhập");
  }

  const check = validateUsername(username);
  if (!check.ok) {
    throw createAppError(400, "USER_USERNAME_INVALID", check.message);
  }

  const user = await User.findByPk(userId);
  if (!user) {
    throw createAppError(404, "USER_NOT_FOUND", "Không tìm thấy tài khoản");
  }

  const existing = await User.findOne({
    where: { username: check.value },
  });
  if (existing && String(existing.id) !== String(userId)) {
    throw createAppError(409, "USER_USERNAME_TAKEN", "Tên hiển thị đã được sử dụng");
  }

  const previous = user.username;
  if (previous === check.value) {
    return { user, changed: false };
  }

  await user.update({ username: check.value });

  try {
    await UserActivityService.createActivity(
      userId,
      "profile_updated",
      `Cập nhật tên hiển thị: ${check.value}`,
      { previousUsername: previous || null, newUsername: check.value }
    );
  } catch (err) {
    console.warn("profile_updated activity log failed:", err.message);
  }

  return { user, changed: true };
}

module.exports = {
  updateUserProfile,
};
