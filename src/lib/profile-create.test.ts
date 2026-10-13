import { describe, expect, it } from "vite-plus/test";
import { NO_TEMPLATE, resolveCreateProfileIntent } from "./profile-create";

describe("resolveCreateProfileIntent", () => {
  it("rejects blank names instead of letting the API answer 400", () => {
    expect(resolveCreateProfileIntent("", NO_TEMPLATE)).toBeNull();
    expect(resolveCreateProfileIntent("   ", "profile-1")).toBeNull();
  });

  it("creates a new profile when no template is selected", () => {
    expect(resolveCreateProfileIntent("  Work  ", NO_TEMPLATE)).toEqual({
      kind: "create",
      name: "Work",
    });
    expect(resolveCreateProfileIntent("Work", "  ")).toEqual({ kind: "create", name: "Work" });
  });

  it("clones from the selected template and keeps the new profile name trimmed", () => {
    expect(resolveCreateProfileIntent(" Work copy ", "profile-1")).toEqual({
      kind: "clone",
      sourceId: "profile-1",
      name: "Work copy",
    });
  });
});
