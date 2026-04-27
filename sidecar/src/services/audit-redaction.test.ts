import { describe, expect, it } from "vite-plus/test";
import { redactForAudit } from "./audit-redaction.js";

describe("redactForAudit", () => {
  it("redacts sensitive keys recursively and truncates long strings", () => {
    const redacted = redactForAudit({
      token: "secret-token",
      nested: { Authorization: "Bearer secret", safe: "visible" },
      text: "x".repeat(260),
    });

    expect(redacted).toMatchObject({
      token: "[REDACTED]",
      nested: { Authorization: "[REDACTED]", safe: "visible" },
    });
    expect((redacted as { text: string }).text).toHaveLength(203);
    expect((redacted as { text: string }).text.endsWith("...")).toBe(true);
  });
});
