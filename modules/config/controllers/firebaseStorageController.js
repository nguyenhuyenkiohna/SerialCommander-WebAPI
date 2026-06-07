const { isFirebaseReady, getStorageBucket, isStorageBucketReady } = require("../../../kernels/firebaseAdmin");
const firebaseStorageService = require("../services/firebaseStorageService");
const { sendError, sendSuccess } = require("../../../kernels/middlewares/errorHandler");
const { logError } = require("../../../kernels/logging/appLogger");

exports.getStatus = async (req, res) => {
  const adminReady = isFirebaseReady();
  const bucketReady = adminReady ? await isStorageBucketReady() : false;
  const bucket = getStorageBucket();
  return sendSuccess(res, 200, "Lấy trạng thái Firebase thành công", {
    status: {
      firestoreAndStorage: adminReady && bucketReady,
      adminReady,
      bucketReady,
      bucketName: bucket?.name ?? null,
      maxFileMb: firebaseStorageService.getMaxBytes() / 1024 / 1024,
      attachmentsPrefix: firebaseStorageService.getAttachmentsPrefix(),
    },
  });
};

exports.uploadFile = async (req, res) => {
  const userId = String(req.user.id);
  try {
    if (!req.file || !req.file.buffer) {
      return sendError(res, 400, "Thiếu file (field tên: file).", "FIREBASE_FILE_MISSING");
    }
    const meta = await firebaseStorageService.uploadUserFile(
      userId,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    return sendSuccess(res, 201, "Đã tải lên Storage.", { file: meta });
  } catch (error) {
    logError("[firebase] Upload Storage failed", { error: error.message });
    return sendError(res, error.statusCode || 500, error.message, "FIREBASE_UPLOAD_FAILED");
  }
};

exports.listFiles = async (req, res) => {
  const userId = String(req.user.id);
  try {
    const files = await firebaseStorageService.listUserFiles(userId);
    return sendSuccess(res, 200, "Lấy danh sách file thành công", { files });
  } catch (error) {
    logError("[firebase] List Storage failed", { error: error.message });
    return sendError(res, error.statusCode || 500, error.message, "FIREBASE_LIST_FAILED");
  }
};

exports.deleteFile = async (req, res) => {
  const userId = String(req.user.id);
  const fileName = req.body?.fileName ?? req.query?.fileName;
  try {
    if (!fileName || typeof fileName !== "string") {
      return sendError(res, 400, "Thiếu fileName (tên file trong thư mục của bạn).", "FIREBASE_FILENAME_REQUIRED");
    }
    await firebaseStorageService.deleteUserFile(userId, fileName);
    return sendSuccess(res, 200, "Đã xóa file.");
  } catch (error) {
    logError("[firebase] Delete Storage failed", { error: error.message });
    return sendError(res, error.statusCode || 500, error.message, "FIREBASE_DELETE_FAILED");
  }
};

exports.signedDownloadUrl = async (req, res) => {
  const userId = String(req.user.id);
  const fileName = req.query?.fileName;
  const expiresMinutes = req.query?.expiresMinutes;
  try {
    if (!fileName || typeof fileName !== "string") {
      return sendError(res, 400, "Thiếu query fileName.", "FIREBASE_FILENAME_REQUIRED");
    }
    const result = await firebaseStorageService.getSignedDownloadUrl(
      userId,
      fileName,
      expiresMinutes
    );
    return sendSuccess(res, 200, "Lấy signed URL thành công", { signedUrl: result });
  } catch (error) {
    logError("[firebase] Signed URL failed", { error: error.message });
    return sendError(res, error.statusCode || 500, error.message, "FIREBASE_SIGNED_URL_FAILED");
  }
};
