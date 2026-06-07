const { sendError, sendSuccess } = require("../../../kernels/middlewares/errorHandler");
const { updateUserProfile } = require("../services/userProfileService");

exports.updateProfile = async (req, res) => {
  const { username } = req.body || {};
  try {
    const { user } = await updateUserProfile(req.user.id, { username });
    return sendSuccess(res, 200, "Cập nhật hồ sơ thành công", {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        provider: user.provider || "local",
        isVerified: user.isVerified === true,
      },
    });
  } catch (error) {
    const status = Number(error.status) || 500;
    const code = error.code || "USER_PROFILE_UPDATE_FAILED";
    if (status >= 500) {
      console.error("updateProfile error:", error);
    }
    return sendError(res, status, error.message || "Không thể cập nhật hồ sơ", code);
  }
};
