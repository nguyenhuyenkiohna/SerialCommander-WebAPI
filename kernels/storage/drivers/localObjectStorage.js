const fs = require("fs");
const path = require("path");
const { getLocalUploadDir, getPublicApiBaseUrl } = require("../uploadStorageConfig");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * @param {{ buffer: Buffer, key: string, mimetype: string }} input
 * @returns {Promise<{ key: string, url: string, provider: string }>}
 */
async function saveObject(input) {
  const dir = getLocalUploadDir();
  const filePath = path.join(dir, input.key);
  ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, input.buffer);

  const baseUrl = getPublicApiBaseUrl();
  return {
    key: input.key,
    url: `${baseUrl}/uploads/${input.key}`,
    provider: "local",
  };
}

async function deleteObject(key) {
  const filePath = path.join(getLocalUploadDir(), key);
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

module.exports = {
  saveObject,
  deleteObject,
};
