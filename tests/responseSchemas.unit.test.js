const {
  scenarioListEnvelopeSchema,
  scenarioMergedResourceSuccessSchema,
} = require("../kernels/validations/responseSchemas");

describe("responseSchemas Zod", () => {
  test("merged resource + message/trace + field kịch bản pass", () => {
    expect(() =>
      scenarioMergedResourceSuccessSchema.parse({
        message: "OK",
        trace_id: "t1",
        Name: "N",
        Content: "[]",
        Banners: [],
      })
    ).not.toThrow();
  });

  test("scenario list envelope", () => {
    expect(() =>
      scenarioListEnvelopeSchema.parse({
        message: "Listed",
        scenarios: [{ Id: "1", Name: "A" }],
      })
    ).not.toThrow();
  });
});
