const multer = require("multer");
const { ALLOWED_IMAGE_TYPES } = require("../../modules/upload/services/objectUploadService");

const fileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type"), false);
  }
};

/** Memory storage — buffer chuyển sang objectUploadService (local/S3). */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
});

module.exports = upload;
