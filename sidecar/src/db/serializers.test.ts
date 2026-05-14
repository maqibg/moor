import { describe, expect, it } from "vite-plus/test";
import { parseJsonValue } from "./serializers.js";

describe("parseJsonValue", () => {
  it("parses JSON strings and returns fallback for null/empty", () => {
    expect(parseJsonValue('["/tmp"]', [])).toEqual(["/tmp"]);
    expect(parseJsonValue(null, [])).toEqual([]);
    expect(parseJsonValue("", {})).toEqual({});
    expect(parseJsonValue(null)).toBeNull();
  });

  it("returns non-string values as-is", () => {
    expect(parseJsonValue(42, 0)).toBe(42);
    expect(parseJsonValue({ a: 1 }, {})).toEqual({ a: 1 });
  });

  it("returns fallback for invalid JSON strings", () => {
    expect(parseJsonValue("not-json", "fallback")).toBe("fallback");
  });
});
