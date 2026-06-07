-- Mẫu truy vấn vận hành cho bảng SyncJobs (đồng bộ MySQL ↔ Firestore)
-- Chạy trực tiếp trên MySQL (phpMyAdmin, CLI, hoặc BI tool).

-- 1) Số lượng theo trạng thái
SELECT Status, COUNT(*) AS cnt
FROM SyncJobs
GROUP BY Status
ORDER BY Status;

-- 2) Hàng đợi sẵn sàng xử lý (pending/failed, đến hạn hoặc chưa có lịch retry)
SELECT COUNT(*) AS due_for_processing
FROM SyncJobs
WHERE Status IN ('pending', 'failed')
  AND (NextRetryAt IS NULL OR NextRetryAt <= UTC_TIMESTAMP());

-- 3) Top backlog theo loại thao tác (đang pending/failed)
SELECT OperationType, COUNT(*) AS cnt
FROM SyncJobs
WHERE Status IN ('pending', 'failed')
GROUP BY OperationType
ORDER BY cnt DESC;

-- 4) Các job failed gần nhất (xem LastError)
SELECT Id, OperationType, ScenarioId, RetryCount, MaxRetries, NextRetryAt, LastError, ModifiedAt
FROM SyncJobs
WHERE Status = 'failed'
ORDER BY ModifiedAt DESC
LIMIT 50;

-- 5) Job pending lâu nhất (phát hiện tắc nghẽn)
SELECT Id, OperationType, ScenarioId, CreatedAt, RetryCount, NextRetryAt, LastError
FROM SyncJobs
WHERE Status = 'pending'
ORDER BY CreatedAt ASC
LIMIT 30;
