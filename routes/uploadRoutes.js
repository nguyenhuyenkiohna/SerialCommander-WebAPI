const express = require("express");
const upload = require("../kernels/middlewares/uploadMiddleware");
const { verifyToken } = require("../kernels/middlewares/authMiddleware");
const { sendError, sendSuccess } = require("../kernels/middlewares/errorHandler");
const objectUploadService = require("../modules/upload/services/objectUploadService");

const router = express.Router();

router.post("/", verifyToken, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return sendError(res, 400, "Không có file được tải lên.", "UPLOAD_FILE_MISSING");
    }

    const stored = await objectUploadService.saveImage({
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      userId: req.user?.id,
    });

    return sendSuccess(res, 200, "Tải ảnh thành công", {
      url: stored.url,
      key: stored.key,
      provider: stored.provider,
    });
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    const code = error.code || "UPLOAD_FAILED";
    return sendError(res, status, error.message || "Upload thất bại", code);
  }
});

module.exports = router;
