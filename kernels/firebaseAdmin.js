const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

let initialized = false;

function resolveServiceAccountFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  try {
    const decoded = Buffer.from(raw.trim(), "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    try {
      return JSON.parse(raw.trim());
    } catch {
      return null;
    }
  }
}

function resolveServiceAccountPath() {
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!keyPath || typeof keyPath !== "string" || keyPath.trim() === "") {
    return null;
  }
  const trimmed = keyPath.trim();
  return path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
}

/**
 * Khởi tạo Firebase Admin (Firestore + Storage bucket) một lần.
 * Storage dùng sau này (ảnh, firmware); Firestore dùng cho JSON kịch bản.
 */
function ensureInitialized() {
  if (initialized) {
    return true;
  }
  let serviceAccount = resolveServiceAccountFromEnv();
  const resolved = resolveServiceAccountPath();
  if (!serviceAccount) {
    if (!resolved || !fs.existsSync(resolved)) {
      return false;
    }
    try {
      serviceAccount = JSON.parse(fs.readFileSync(resolved, "utf8"));
    } catch (e) {
      console.error("[firebase] Không đọc được service account file:", e.message);
      return false;
    }
  }
  try {
    const projectId = serviceAccount.project_id;
    const bucket =
      process.env.FIREBASE_STORAGE_BUCKET ||
      (projectId ? `${projectId}.firebasestorage.app` : undefined);

    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        ...(bucket ? { storageBucket: bucket } : {}),
      });
    }
    initialized = true;
    return true;
  } catch (e) {
    console.error("[firebase] Không khởi tạo được Firebase Admin:", e.message);
    return false;
  }
}

function isFirebaseReady() {
  return ensureInitialized();
}

function getFirestore() {
  return ensureInitialized() ? admin.firestore() : null;
}

function getStorageBucket() {
  if (!ensureInitialized()) {
    return null;
  }
  return admin.storage().bucket();
}

/** Kiểm tra bucket Storage thật sự tồn tại trên GCP (khác với chỉ init Admin SDK). */
async function isStorageBucketReady() {
  const bucket = getStorageBucket();
  if (!bucket) return false;
  try {
    const [exists] = await bucket.exists();
    return exists;
  } catch {
    return false;
  }
}

function getAdmin() {
  return ensureInitialized() ? admin : null;
}

module.exports = {
  isFirebaseReady,
  getFirestore,
  getStorageBucket,
  isStorageBucketReady,
  getAdmin,
};
