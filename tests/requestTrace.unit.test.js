const crypto = require("crypto");
const { resolveTraceId } = require("kernels/middlewares/requestTraceMiddleware");

describe("requestTraceMiddleware.resolveTraceId", () => {
  test("ưu tiên x-request-id hợp lệ", () => {
    const id = resolveTraceId({
      headers: { "x-request-id": "client-req-001" },
    });
    expect(id).toBe("client-req-001");
  });

  test("đọc trace-id từ traceparent W3C", () => {
    const tid = "0af7651916cd43dd8448eb211c80319c";
    const id = resolveTraceId({
      headers: { traceparent: `00-${tid}-00f067aa0ba902b7-01` },
    });
    expect(id).toBe(tid);
  });

  test("traceparent sai định dạng thì sinh UUID mới", () => {
    const id = resolveTraceId({
      headers: { traceparent: "invalid" },
    });
    expect(() => crypto.randomUUID()).not.toThrow();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});
