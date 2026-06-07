const express = require("express");
const { createSimpleRateLimit } = require("../kernels/middlewares/simpleRateLimit");
const youtubeController = require("../modules/youtube/youtubeController");

const router = express.Router();

const searchRateLimit = createSimpleRateLimit({
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.YOUTUBE_SEARCH_RL_PER_MIN ?? 40),
});

router.get("/search", searchRateLimit, youtubeController.searchVideos);

module.exports = router;
