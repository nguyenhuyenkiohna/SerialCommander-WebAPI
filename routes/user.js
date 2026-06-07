const express = require("express");
const router = express.Router();
const { verifyToken }  = require("../kernels/middlewares/authMiddleware");
const { sendError, sendSuccess } = require("../kernels/middlewares/errorHandler");
const { User } = require("../models");
const userActivityController = require("../modules/user/controllers/userActivityController");
const userProfileController = require("../modules/user/controllers/userProfileController");

router.get("/profile", verifyToken, async (req, res) => {
  try {
    // Lấy thông tin đầy đủ từ database
    const user = await User.findByPk(req.user.id, {
      attributes: ["id", "username", "email", "role", "provider", "googleId", "isVerified"],
    });

    if (!user) {
      return sendError(res, 404, "User not found", "USER_NOT_FOUND");
    }

    return sendSuccess(res, 200, "Đây là thông tin profile của bạn", {
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
    console.error("Error fetching user profile:", error);
    return sendError(res, 500, "Internal server error", "USER_PROFILE_FETCH_FAILED");
  }
});

router.patch("/profile", verifyToken, userProfileController.updateProfile);

// User Activity routes
router.get("/activities", verifyToken, userActivityController.getUserActivities);
router.get("/activities/stats", verifyToken, userActivityController.getUserActivityStats);
router.post("/activities", verifyToken, userActivityController.createActivity);

module.exports = router;
