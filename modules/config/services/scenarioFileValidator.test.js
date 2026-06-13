"use strict";

const {
  validateScenarioFile,
  positionToLineColumn,
  getSyntaxErrorPosition,
} = require("./scenarioFileValidator");

const { VALID_CONTENT_TYPES } = require("./scenarioFileValidator");

describe("scenarioFileValidator", () => {
  test("valid minimal scenario JSON", () => {
    const json = JSON.stringify({
      Name: "Test",
      Content: [{ Type: "text", Name: "A" }],
    });
    const r = validateScenarioFile(json);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  // ── chart block type ────────────────────────────────────────────────────────

  test("VALID_CONTENT_TYPES includes chart", () => {
    expect(VALID_CONTENT_TYPES).toContain("chart");
  });

  test("accepts chart as a valid Content Type", () => {
    const json = JSON.stringify({
      Name: "IoT Demo",
      Content: [
        { Type: "chart", Name: "Nhiệt độ" },
      ],
    });
    const r = validateScenarioFile(json);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  test("toogle legacy alias → warning + chuẩn hóa toggle", () => {
    const json = JSON.stringify({
      Name: "Legacy",
      Content: [{ Type: "toogle", Name: "Switch" }],
    });
    const r = validateScenarioFile(json);
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => /toogle/i.test(w.message))).toBe(true);
  });

  test("accepts chart alongside gauge and progress", () => {
    const json = JSON.stringify({
      Name: "Sensor board",
      Content: [
        { Type: "button",   Name: "Poll"        },
        { Type: "gauge",    Name: "Nhiệt độ"    },
        { Type: "progress", Name: "Độ ẩm"       },
        { Type: "chart",    Name: "Lịch sử nhiệt độ" },
      ],
    });
    const r = validateScenarioFile(json);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  test("chart with PollIntervalMs field passes without error", () => {
    const json = JSON.stringify({
      Name: "Chart self-poll",
      Content: [
        {
          Type: "chart",
          Name: "Nhiệt độ (live)",
          TxFormats: ["READ_SENSOR"],
          Params: [{ Name: "°C", Min: -10, Max: 60 }],
          RxParser: "json:temp",
          PollIntervalMs: 2000,
        },
      ],
    });
    const r = validateScenarioFile(json);
    expect(r.valid).toBe(true);
  });

  test("rejects empty or whitespace input", () => {
    expect(validateScenarioFile("   ").valid).toBe(false);
    expect(validateScenarioFile("").valid).toBe(false);
  });

  test("rejects non-string input", () => {
    const r = validateScenarioFile(null);
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toMatch(/phải là chuỗi/i);
  });

  test("rejects invalid Content Type enum", () => {
    const json = JSON.stringify({
      Name: "T",
      Content: [{ Type: "not_a_valid_type", Name: "A" }],
    });
    const r = validateScenarioFile(json);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path && String(e.path).includes("Type"))).toBe(true);
  });

  test("rejects missing Name at root", () => {
    const json = JSON.stringify({ Content: [] });
    const r = validateScenarioFile(json);
    expect(r.valid).toBe(false);
  });

  test("positionToLineColumn", () => {
    expect(positionToLineColumn("a\nb", 0)).toEqual({ line: 1, column: 0 });
    expect(positionToLineColumn("a\nb", 2)).toEqual({ line: 2, column: 0 });
  });

  test("getSyntaxErrorPosition parses JSON error position", () => {
    const err = new SyntaxError("Unexpected token at position 3");
    err.message = "Unexpected token at position 3";
    const pos = getSyntaxErrorPosition('{"x"', err);
    expect(pos).not.toBeNull();
    if (pos) {
      expect(pos.line).toBeGreaterThanOrEqual(1);
    }
  });
});
