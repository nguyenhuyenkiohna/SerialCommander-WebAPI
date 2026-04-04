const express = require("express");
const router = express.Router();
const { verifyToken }  = require("../kernels/middlewares/authMiddleware");
const { User } = require("../models");
const userActivityController = require("../modules/user/controllers/userActivityController");

router.get("/profile", verifyToken, async (req, res) => {
  try {
    // Lấy thông tin đầy đủ từ database
    const user = await User.findByPk(req.user.id, {
      attributes: ["id", "username", "email", "role", "provider", "googleId", "isVerified"],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ 
      message: "Đây là thông tin profile của bạn", 
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
    res.status(500).json({ message: "Internal server error" });
  }
});

// User Activity routes
router.get("/activities", verifyToken, userActivityController.getUserActivities);
router.get("/activities/stats", verifyToken, userActivityController.getUserActivityStats);
router.post("/activities", verifyToken, userActivityController.createActivity);

module.exports = router;
