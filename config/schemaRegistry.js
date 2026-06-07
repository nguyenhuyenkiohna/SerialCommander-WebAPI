/**
 * Phiên bản schema DB mà mã nguồn hiện tại yêu cầu.
 * Khi thêm migration SQL mới: tăng số này và cập nhật giá trị trên server
 * (UPDATE app_schema_registry SET schema_version = ... sau khi chạy SQL).
 */
module.exports = {
  EXPECTED_SCHEMA_VERSION: 14,
};
