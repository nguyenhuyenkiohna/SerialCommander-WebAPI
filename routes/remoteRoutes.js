const express = require("express");
const { verifyToken } = require("../kernels/middlewares/authMiddleware");
const { createSimpleRateLimit } = require("../kernels/middlewares/simpleRateLimit");
const remoteSessionController = require("../modules/remote/controllers/remoteSessionController");

const router = express.Router();

const createSessionLimit = createSimpleRateLimit({
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.REMOTE_SESSION_CREATE_PER_MIN ?? 20),
});

const verifySessionLimit = createSimpleRateLimit({
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.REMOTE_SESSION_VERIFY_PER_MIN ?? 60),
});

const inviteEmailLimit = createSimpleRateLimit({
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.REMOTE_SESSION_INVITE_EMAIL_PER_MIN ?? 10),
});

router.post("/session", verifyToken, createSessionLimit, remoteSessionController.createSession);
router.post(
  "/session/verify",
  verifyToken,
  verifySessionLimit,
  remoteSessionController.verifySession
);
router.post(
  "/session/invite-email",
  verifyToken,
  inviteEmailLimit,
  remoteSessionController.sendInviteEmail
);
router.post(
  "/session/kick-station",
  verifyToken,
  createSimpleRateLimit({ windowMs: 60 * 1000, maxRequests: 60 }),
  remoteSessionController.kickSessionStation
);

module.exports = router;
