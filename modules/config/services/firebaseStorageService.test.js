process.env.NODE_ENV = "test";

require("rootpath")();

const mockFile = {
  save: jest.fn(),
};
const mockBucket = {
  name: "bucket-test",
  file: jest.fn(() => mockFile),
};

jest.mock("kernels/firebaseAdmin", () => ({
  isFirebaseReady: jest.fn(),
  getStorageBucket: jest.fn(),
}));

const firebaseAdmin = require("kernels/firebaseAdmin");
const firebaseStorageService = require("./firebaseStorageService");

describe("firebaseStorageService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    firebaseAdmin.isFirebaseReady.mockReturnValue(true);
    firebaseAdmin.getStorageBucket.mockReturnValue(mockBucket);
  });

  test("uploadUserFile throws when firebase not ready", async () => {
    firebaseAdmin.isFirebaseReady.mockReturnValue(false);
    await expect(
      firebaseStorageService.uploadUserFile("1", Buffer.from("a"), "a.txt", "text/plain")
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  test("uploadUserFile returns stored metadata", async () => {
    mockFile.save.mockResolvedValue(true);
    const out = await firebaseStorageService.uploadUserFile(
      "99",
      Buffer.from("hello"),
      "my-file.txt",
      "text/plain"
    );
    expect(out).toHaveProperty("fileName", "my-file.txt");
    expect(out).toHaveProperty("bucket", "bucket-test");
    expect(mockBucket.file).toHaveBeenCalled();
  });
});
