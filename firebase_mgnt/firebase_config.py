# firebase_config.py

# Khớp serviceAccountKey.json trong cùng thư mục (project serial-commander-2caea)
PROJECT_ID = "serial-commander-2caea"

# Đường dẫn đến file service account (cùng thư mục firebase_mgnt/)
PATH_TO_JSON = "serviceAccountKey.json"

# Bucket Firebase Storage (Console → Build → Storage)
STORAGE_BUCKET = f"{PROJECT_ID}.firebasestorage.app"

# Tên của thư mục lưu trong storage lưu trữ các file ngoài của kịch bản, như là ảnh, file partition.bin...
SCENARIO_FIREBASE_STORAGE_FOLDER = "attachments"
# Tên của collection trong firetore, lưu trữ các kịch bản cấu hình serial
SCENARIO_FIRESTORE_COLLECTION = "scenarios"