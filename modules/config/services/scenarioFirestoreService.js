const { getFirestore, getAdmin, isFirebaseReady } = require("../../../kernels/firebaseAdmin");
const { logWarn } = require("../../../kernels/logging/appLogger");
const firebaseStorageService = require("./firebaseStorageService");

const COLLECTION =
  process.env.FIREBASE_SCENARIOS_COLLECTION || "scenarios";

function assertFirestore() {
  if (!isFirebaseReady()) {
    const err = new Error(
      "Firestore chưa sẵn sàng. Đặt FIREBASE_SERVICE_ACCOUNT_PATH trong .env trỏ tới file serviceAccountKey.json."
    );
    err.statusCode = 503;
    throw err;
  }
}

/**
 * Lưu mảng lệnh kịch bản (JSON) vào Firestore. Document id = Scenario.Id (UUID).
 * @param {string} scenarioId
 * @param {Array} contentArray
 */
exports.saveScenarioContent = async (scenarioId, contentArray) => {
  await exports.batchSaveScenarioContent([
    { scenarioId, content: Array.isArray(contentArray) ? contentArray : [] },
  ]);
};

/**
 * Batch Write Firestore cho nhiều scenario (worker outbox).
 * @param {{ scenarioId: string, content: Array }[]} items
 */
exports.batchSaveScenarioContent = async (items) => {
  if (!items?.length) return;
  assertFirestore();
  const db = getFirestore();
  const admin = getAdmin();
  const batch = db.batch();

  for (const item of items) {
    const ref = db.collection(COLLECTION).doc(item.scenarioId);
    batch.set(ref, {
      content: Array.isArray(item.content) ? item.content : [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();

  await Promise.allSettled(
    items.map((item) =>
      firebaseStorageService.saveScenarioJsonSnapshot(
        item.scenarioId,
        Array.isArray(item.content) ? item.content : []
      )
    )
  );
};

/**
 * Đọc mảng nội dung kịch bản từ Firestore.
 * @returns {Promise<Array|null>} null nếu không có document hoặc Firebase tắt.
 */
exports.getScenarioContentArray = async (scenarioId) => {
  const db = getFirestore();
  if (!db) {
    return null;
  }
  try {
    const snap = await db.collection(COLLECTION).doc(scenarioId).get();
    if (!snap.exists) {
      return null;
    }
    const data = snap.data();
    if (Array.isArray(data.content)) {
      return data.content.length > 0 ? data.content : null;
    }
    if (Array.isArray(data.Content)) {
      return data.Content.length > 0 ? data.Content : null;
    }
    return null;
  } catch (e) {
    logWarn("[scenario-firestore] đọc Firestore thất bại — dùng Content MySQL", {
      scenarioId,
      message: e.message || String(e),
      code: e.code,
    });
    return null;
  }
};

/**
 * Xóa document kịch bản trên Firestore (best-effort nếu Firebase tắt).
 */
exports.deleteScenarioContent = async (scenarioId) => {
  await exports.batchDeleteScenarioContent([scenarioId]);
};

/**
 * @param {string[]} scenarioIds
 */
exports.batchDeleteScenarioContent = async (scenarioIds) => {
  if (!scenarioIds?.length) return;
  const db = getFirestore();
  if (!db) return;

  const batch = db.batch();
  for (const scenarioId of scenarioIds) {
    batch.delete(db.collection(COLLECTION).doc(scenarioId));
  }
  await batch.commit();

  await Promise.allSettled(
    scenarioIds.map((id) => firebaseStorageService.deleteScenarioJsonSnapshot(id))
  );
};

exports.getScenariosCollectionName = () => COLLECTION;
