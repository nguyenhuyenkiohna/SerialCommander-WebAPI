process.env.NODE_ENV = "test";

require("rootpath")();

const fs = require("fs");
const path = require("path");
const objectUploadService = require("modules/upload/services/objectUploadService");

const testDir = path.join(process.cwd(), "uploads", "_test_uploads");

describe("objectUploadService", () => {
  beforeAll(() => {
    process.env.UPLOAD_STORAGE_DRIVER = "local";
    process.env.UPLOAD_LOCAL_DIR = testDir;
    process.env.API_BASE_URL = "http://localhost:2999";
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("saveImage ghi local qua driver, không qua route", async () => {
    const buf = Buffer.from("fake-image");
    const out = await objectUploadService.saveImage({
      buffer: buf,
      originalname: "photo.jpg",
      mimetype: "image/jpeg",
      userId: 99,
    });

    expect(out.provider).toBe("local");
    expect(out.url).toContain("/uploads/");
    expect(fs.existsSync(path.join(testDir, out.key))).toBe(true);
  });

  test("từ chối mime không hợp lệ", async () => {
    await expect(
      objectUploadService.saveImage({
        buffer: Buffer.from("x"),
        originalname: "a.exe",
        mimetype: "application/octet-stream",
        userId: 1,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
