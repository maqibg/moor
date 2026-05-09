import { describe, expect, it } from "vite-plus/test";
import type { Profile } from "@moor/types";
import { getProfilesForDisplay } from "./profiles-state";

function profile(id: string, isActive = false): Profile {
  return {
    id,
    name: id,
    isActive,
    serverCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("profiles display state", () => {
  it("pins the active profile first while preserving visual indexes", () => {
    const profiles = [profile("vibe"), profile("default", true), profile("work")];

    expect(getProfilesForDisplay(profiles)).toEqual([
      { profile: profiles[1], originalIndex: 1 },
      { profile: profiles[0], originalIndex: 0 },
      { profile: profiles[2], originalIndex: 2 },
    ]);
  });
});
