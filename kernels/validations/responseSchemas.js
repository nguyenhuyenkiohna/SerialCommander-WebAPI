const { z } = require("zod");

/**
 * Chỉ ép contract tối thiểu; field kịch bản cho phép mở qua passthrough().
 */
const scenarioMergedResourceSuccessSchema = z
  .object({
    message: z.string().min(1),
    trace_id: z.string().optional(),
  })
  .passthrough();

const scenarioListEnvelopeSchema = z.object({
  message: z.string().min(1),
  scenarios: z.array(z.record(z.unknown())),
  trace_id: z.string().optional(),
});

module.exports = {
  scenarioMergedResourceSuccessSchema,
  scenarioListEnvelopeSchema,
};
