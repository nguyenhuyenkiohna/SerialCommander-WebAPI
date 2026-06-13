const { getFirestore, getAdmin, isFirebaseReady } = require("../../../kernels/firebaseAdmin");
const { logWarn } = require("../../../kernels/logging/appLogger");
const { getOutboxClient } = require("../../../kernels/redis/redisClients");
const firebaseStorageService = require("./firebaseStorageService");

// Cache Firestore content trong Redis để tránh round-trip Firestore trên mỗi GET.
// TTL 120s: dữ liệu có thể trễ tối đa 2 phút sau khi outbox worker sync xong.
const CONTENT_CACHE_TTL_SEC = Number(process.env.SCENARIO_CONTENT_CACHE_TTL_SEC || 120);
const CONTENT_CACHE_PREFIX = "scenario:content:cache:";

async function getCacheClient() {
  const client = getOutboxClient();
  if (!client) return null;
  if (client.status !== "ready") {
    try { await client.connect(); } catch { return null; }
  }
  return client;
}

async function cacheGetContent(scenarioId) {
  const client = await getCacheClient();
  if (!client) return undefined; // undefined = cache miss (null = document không tồn tại)
  try {
    const raw = await client.get(`${CONTENT_CACHE_PREFIX}${scenarioId}`);
    if (raw === null) return undefined; // key không có trong Redis
    return JSON.parse(raw); // có thể là null (đã cached "không có document")
  } catch {
    return undefined;
  }
}

async function cacheSetContent(scenarioId, content) {
  const client = await getCacheClient();
  if (!client) return;
  try {
    // Lưu cả null (không có document) để tránh cache stampede
    await client.set(
      `${CONTENT_CACHE_PREFIX}${scenarioId}`,
      JSON.stringify(content),
      "EX",
      CONTENT_CACHE_TTL_SEC
    );
  } catch { /* best-effort */ }
}

async function cacheInvalidateContent(scenarioId) {
  const client = await getCacheClient();
  if (!client) return;
  try {
    await client.del(`${CONTENT_CACHE_PREFIX}${scenarioId}`);
  } catch { /* best-effort */ }
}

async function cacheInvalidateMany(scenarioIds) {
  const client = await getCacheClient();
  if (!client || !scenarioIds?.length) return;
  try {
    const keys = scenarioIds.map((id) => `${CONTENT_CACHE_PREFIX}${id}`);
    await client.del(...keys);
  } catch { /* best-effort */ }
}

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

  // Invalidate cache sau khi Firestore đã có dữ liệu mới
  await cacheInvalidateMany(items.map((i) => i.scenarioId));

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
 * Đọc mảng nội dung kịch bản từ Firestore, với Redis cache (TTL 120s).
 * @returns {Promise<Array|null>} null nếu không có document hoặc Firebase tắt.
 */
exports.getScenarioContentArray = async (scenarioId) => {
  // 1. Thử cache trước
  const cached = await cacheGetContent(scenarioId);
  if (cached !== undefined) return cached; // cache hit (kể cả null)

  const db = getFirestore();
  if (!db) {
    return null;
  }
  try {
    const snap = await db.collection(COLLECTION).doc(scenarioId).get();
    let result = null;
    if (snap.exists) {
      const data = snap.data();
      if (Array.isArray(data.content)) {
        result = data.content.length > 0 ? data.content : null;
      } else if (Array.isArray(data.Content)) {
        result = data.Content.length > 0 ? data.Content : null;
      }
    }
    await cacheSetContent(scenarioId, result); // cache cả null
    return result;
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

  // Invalidate cache ngay sau khi xóa
  await cacheInvalidateMany(scenarioIds);

  await Promise.allSettled(
    scenarioIds.map((id) => firebaseStorageService.deleteScenarioJsonSnapshot(id))
  );
};

const FIRESTORE_GETALL_CHUNK = 10;

/**
 * Batch đọc content nhiều scenario (tối đa 10 doc/lần theo Firestore getAll).
 * @param {string[]} scenarioIds
 * @returns {Promise<Map<string, Array|null>>}
 */
exports.batchGetScenarioContentArrays = async (scenarioIds) => {
  const map = new Map();
  if (!scenarioIds?.length) return map;

  const uniqueIds = [...new Set(scenarioIds.filter(Boolean))];

  // 1. Thử lấy từ cache trước — tránh Firestore round-trip cho mỗi item
  const missIds = [];
  await Promise.all(
    uniqueIds.map(async (id) => {
      const cached = await cacheGetContent(id);
      if (cached !== undefined) {
        map.set(id, cached); // cache hit
      } else {
        missIds.push(id); // cần đọc Firestore
      }
    })
  );

  if (!missIds.length) return map; // tất cả đều có trong cache

  const db = getFirestore();
  if (!db) {
    for (const id of missIds) map.set(id, null);
    return map;
  }

  // 2. Đọc Firestore cho các id bị cache miss
  for (let i = 0; i < missIds.length; i += FIRESTORE_GETALL_CHUNK) {
    const chunk = missIds.slice(i, i + FIRESTORE_GETALL_CHUNK);
    const refs = chunk.map((id) => db.collection(COLLECTION).doc(id));
    try {
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) {
        let result = null;
        if (snap.exists) {
          const data = snap.data();
          if (Array.isArray(data.content)) {
            result = data.content.length > 0 ? data.content : null;
          } else if (Array.isArray(data.Content)) {
            result = data.Content.length > 0 ? data.Content : null;
          }
        }
        map.set(snap.id, result);
        // 3. Populate cache cho lần đọc tiếp theo
        await cacheSetContent(snap.id, result);
      }
    } catch (e) {
      logWarn("[scenario-firestore] batch getAll thất bại — fallback null", {
        chunkSize: chunk.length,
        message: e.message || String(e),
      });
      for (const id of chunk) map.set(id, null);
    }
  }

  return map;
};

exports.getScenariosCollectionName = () => COLLECTION;
