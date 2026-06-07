const express = require("express");
const multer = require("multer");
const { verifyToken } = require("../kernels/middlewares/authMiddleware");
const { sendError } = require("../kernels/middlewares/errorHandler");
const firebaseUpload = require("../kernels/middlewares/firebaseStorageUploadMiddleware");
const firebaseStorageController = require("../modules/config/controllers/firebaseStorageController");

const router = express.Router();

router.use(verifyToken);

function uploadSingleWithMulterErrors(req, res, next) {
  firebaseUpload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return sendError(res, 400, err.message, "FIREBASE_UPLOAD_INVALID_FILE");
    }
    if (err) return next(err);
    return next();
  });
}

router.get("/storage/status", firebaseStorageController.getStatus);
router.post(
  "/storage/upload",
  uploadSingleWithMulterErrors,
  firebaseStorageController.uploadFile
);
router.get("/storage/files", firebaseStorageController.listFiles);
router.delete("/storage/file", firebaseStorageController.deleteFile);
router.get("/storage/download-url", firebaseStorageController.signedDownloadUrl);

module.exports = router;
