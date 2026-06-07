/**
 * Driver S3/MinIO — sẵn sàng thay thế SDK thật (@aws-sdk/client-s3).
 * Dev: UPLOAD_S3_SIMULATE_LOCAL=true ghi vào uploads/.s3-stub/ và trả URL giả lập.
 */
const path = require("path");
const fs = require("fs");
const { logWarn, logInfo } = require("../../logging/appLogger");
const { getS3Config, getLocalUploadDir } = require("../uploadStorageConfig");

let sdkWarned = false;

function buildPublicUrl(key, cfg) {
  if (cfg.publicBaseUrl) {
    return `${cfg.publicBaseUrl}/${key}`;
  }
  if (cfg.endpoint) {
    return `${cfg.endpoint.replace(/\/+$/, "")}/${cfg.bucket}/${key}`;
  }
  return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`;
}

async function trySdkPutObject({ buffer, key, mimetype, cfg }) {
  let S3Client;
  let PutObjectCommand;
  try {
    ({ S3Client, PutObjectCommand } = require("@aws-sdk/client-s3"));
  } catch {
    return null;
  }

  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: Boolean(cfg.endpoint),
    credentials:
      cfg.accessKeyId && cfg.secretAccessKey
        ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
        : undefined,
  });

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    })
  );

  return {
    key,
    url: buildPublicUrl(key, cfg),
    provider: "s3",
  };
}

async function simulateSave({ buffer, key, mimetype }) {
  const cfg = getS3Config();
  const stubDir = path.join(getLocalUploadDir(), ".s3-stub");
  const filePath = path.join(stubDir, key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, buffer);
  logInfo("[upload-storage] S3 simulate local write", { key, mimetype });
  return {
    key,
    url: buildPublicUrl(key, cfg),
    provider: "s3-simulated",
  };
}

/**
 * @param {{ buffer: Buffer, key: string, mimetype: string }} input
 */
async function saveObject(input) {
  const cfg = getS3Config();
  if (!cfg.bucket) {
    const err = new Error(
      "UPLOAD_STORAGE_DRIVER=s3 nhưng thiếu UPLOAD_S3_BUCKET. Đặt driver=local hoặc cấu hình S3."
    );
    err.statusCode = 503;
    err.code = "UPLOAD_S3_NOT_CONFIGURED";
    throw err;
  }

  const sdkResult = await trySdkPutObject({ ...input, cfg });
  if (sdkResult) {
    return sdkResult;
  }

  if (!sdkWarned) {
    logWarn(
      "[upload-storage] @aws-sdk/client-s3 chưa cài — dùng simulate hoặc cài SDK. Set UPLOAD_S3_SIMULATE_LOCAL=true cho dev.",
      { bucket: cfg.bucket }
    );
    sdkWarned = true;
  }

  if (cfg.simulateLocal) {
    return simulateSave(input);
  }

  const err = new Error(
    "S3 upload chưa sẵn sàng: cài @aws-sdk/client-s3 hoặc bật UPLOAD_S3_SIMULATE_LOCAL=true (dev only)."
  );
  err.statusCode = 503;
  err.code = "UPLOAD_S3_SDK_MISSING";
  throw err;
}

async function deleteObject(_key) {
  logWarn("[upload-storage] deleteObject S3 chưa implement — no-op", { key: _key });
}

module.exports = {
  saveObject,
  deleteObject,
};
