const path = require("path");
const {
  getStorageBucket,
  isFirebaseReady,
  isStorageBucketReady,
} = require("../../../kernels/firebaseAdmin");

function attachmentsPrefix() {
  return (process.env.FIREBASE_STORAGE_ATTACHMENTS_PREFIX || "attachments").replace(/\/+$/, "");
}

function maxBytes() {
  const mb = parseInt(process.env.FIREBASE_STORAGE_MAX_MB || "5", 10);
  const n = Number.isFinite(mb) && mb > 0 ? mb : 5;
  return n * 1024 * 1024;
}

function scenarioJsonPrefix() {
  return (process.env.FIREBASE_STORAGE_SCENARIO_JSON_PREFIX || "scenario-json").replace(/\/+$/, "");
}

function sanitizeFilename(name) {
  const base = path.basename(name || "upload").replace(/[^\w.\-()+ ]/g, "_");
  return base.slice(0, 200) || "file";
}

function userFilesPrefix(userId) {
  return `${attachmentsPrefix()}/users/${userId}/`;
}

function assertBucket() {
  if (!isFirebaseReady()) {
    const e = new Error(
      "Firebase Storage chưa sẵn sàng. Cấu hình FIREBASE_SERVICE_ACCOUNT_PATH và bucket."
    );
    e.statusCode = 503;
    throw e;
  }
  const bucket = getStorageBucket();
  if (!bucket) {
    const e = new Error("Storage bucket không khả dụng.");
    e.statusCode = 503;
    throw e;
  }
  return bucket;
}

/**
 * Snapshot JSON kịch bản (bổ sung cho Firestore — file trên Storage, dễ tải/backup).
 * Best-effort: lỗi chỉ ghi log, không làm hỏng luồng chính.
 */
exports.saveScenarioJsonSnapshot = async (scenarioId, contentArray) => {
  try {
    if (!(await isStorageBucketReady())) {
      return;
    }
    const bucket = assertBucket();
    const objectPath = `${scenarioJsonPrefix()}/${scenarioId}.json`;
    const body = JSON.stringify(
      {
        scenarioId,
        content: Array.isArray(contentArray) ? contentArray : [],
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    );
    await bucket.file(objectPath).save(body, {
      contentType: "application/json; charset=utf-8",
      resumable: false,
    });
  } catch (e) {
    console.warn("[firebase] Snapshot kịch bản lên Storage thất bại:", e.message);
  }
};

exports.deleteScenarioJsonSnapshot = async (scenarioId) => {
  try {
    const bucket = getStorageBucket();
    if (!bucket) return;
    const objectPath = `${scenarioJsonPrefix()}/${scenarioId}.json`;
    await bucket.file(objectPath).delete({ ignoreNotFound: true });
  } catch (e) {
    console.warn("[firebase] Xóa snapshot JSON Storage thất bại:", scenarioId, e.message);
  }
};

/**
 * Upload file đính kèm (ảnh, firmware, …) — mỗi user một thư mục con.
 */
exports.uploadUserFile = async (userId, buffer, originalname, mimetype) => {
  const bucket = assertBucket();
  if (!buffer || buffer.length === 0) {
    const e = new Error("File rỗng.");
    e.statusCode = 400;
    throw e;
  }
  if (buffer.length > maxBytes()) {
    const e = new Error(`File vượt quá giới hạn ${maxBytes() / 1024 / 1024} MB.`);
    e.statusCode = 400;
    throw e;
  }
  const safe = sanitizeFilename(originalname);
  const objectPath = `${userFilesPrefix(userId)}${safe}`;
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    contentType: mimetype || "application/octet-stream",
    resumable: false,
  });
  return {
    path: objectPath,
    fileName: safe,
    size: buffer.length,
    bucket: bucket.name,
  };
};

exports.listUserFiles = async (userId) => {
  const bucket = assertBucket();
  const prefix = userFilesPrefix(userId);
  const [files] = await bucket.getFiles({ prefix });
  const out = [];
  for (const f of files) {
    const relative = f.name.slice(prefix.length);
    if (!relative) continue;
    const [meta] = await f.getMetadata();
    out.push({
      fileName: relative,
      path: f.name,
      size: Number(meta.size) || 0,
      contentType: meta.contentType || null,
      updated: meta.updated || null,
    });
  }
  return out;
};

exports.deleteUserFile = async (userId, fileName) => {
  const bucket = assertBucket();
  const safe = sanitizeFilename(fileName);
  const fullPath = `${userFilesPrefix(userId)}${safe}`;
  await bucket.file(fullPath).delete({ ignoreNotFound: true });
};

/**
 * URL có chữ ký, thời hạn ngắn — client tải file không cần Admin SDK.
 */
exports.getSignedDownloadUrl = async (userId, fileName, expiresMinutes = 15) => {
  const bucket = assertBucket();
  const safe = sanitizeFilename(fileName);
  const fullPath = `${userFilesPrefix(userId)}${safe}`;
  const file = bucket.file(fullPath);
  const [exists] = await file.exists();
  if (!exists) {
    const e = new Error("Không tìm thấy file.");
    e.statusCode = 404;
    throw e;
  }
  const minutes = Math.min(Math.max(parseInt(expiresMinutes, 10) || 15, 1), 60);
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + minutes * 60 * 1000,
  });
  return { url, expiresInMinutes: minutes };
};

exports.getAttachmentsPrefix = attachmentsPrefix;
exports.getMaxBytes = maxBytes;
