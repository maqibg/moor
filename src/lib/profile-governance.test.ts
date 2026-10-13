import { describe, expect, it } from "vite-plus/test";
import type { ProfileToolGroup } from "@moor/types";
import {
  buildGovernanceDraft,
  countDisabledTools,
  diffGovernanceDraft,
  mergeHiddenDisabledTools,
  toggleDraftTool,
} from "./profile-governance";

function group(overrides: Partial<ProfileToolGroup> = {}): ProfileToolGroup {
  return {
    serverId: "srv-a",
    serverName: "Alpha",
    serverEnabled: true,
    tools: [
      {
        toolName: "search",
        exposedName: "alpha__search",
        description: null,
        inputSchema: null,
        disabled: false,
      },
      {
        toolName: "write",
        exposedName: "alpha__write",
        description: null,
        inputSchema: null,
        disabled: true,
      },
    ],
    ...overrides,
  };
}

describe("profile governance draft", () => {
  it("builds a draft from the server groups", () => {
    const draft = buildGovernanceDraft([group()]);
    expect(draft["srv-a"]).toEqual({ enabled: true, disabledTools: ["write"] });
    expect(countDisabledTools([group()])).toBe(1);
  });

  it("toggles a single tool without touching the rest", () => {
    const draft = buildGovernanceDraft([group()]);
    const enabled = toggleDraftTool(draft, "srv-a", "write", false);
    expect(enabled["srv-a"].disabledTools).toEqual([]);
    const disabled = toggleDraftTool(enabled, "srv-a", "search", true);
    expect(disabled["srv-a"].disabledTools).toEqual(["search"]);
    // 未知 serverId 原样返回，不制造幽灵条目
    expect(toggleDraftTool(draft, "missing", "search", true)).toBe(draft);
  });

  it("only sends the fields that actually changed", () => {
    const groups = [group()];
    const draft = buildGovernanceDraft(groups);
    expect(diffGovernanceDraft(groups, draft)).toEqual([]);

    const serverToggled = { ...draft, "srv-a": { ...draft["srv-a"], enabled: false } };
    expect(diffGovernanceDraft(groups, serverToggled)).toEqual([
      { serverId: "srv-a", enabled: false },
    ]);

    const toolsToggled = toggleDraftTool(draft, "srv-a", "search", true);
    expect(diffGovernanceDraft(groups, toolsToggled)).toEqual([
      { serverId: "srv-a", disabledTools: ["search", "write"] },
    ]);

    const bothToggled = toggleDraftTool(serverToggled, "srv-a", "search", true);
    expect(diffGovernanceDraft(groups, bothToggled)).toEqual([
      { serverId: "srv-a", enabled: false, disabledTools: ["search", "write"] },
    ]);
  });

  it("ignores unknown servers in the draft", () => {
    const groups = [group()];
    expect(diffGovernanceDraft(groups, {})).toEqual([]);
  });

  it("keeps disabled tools that are no longer discovered when patching", () => {
    const groups = [group()];
    const draft = toggleDraftTool(buildGovernanceDraft(groups), "srv-a", "search", true);
    const updates = diffGovernanceDraft(groups, draft);

    expect(
      mergeHiddenDisabledTools(updates, groups, { "srv-a": ["search", "write", "retired"] }),
    ).toEqual([{ serverId: "srv-a", disabledTools: ["retired", "search", "write"] }]);
    // 可见行以用户意图为准：刚被重新启用的 write 不会被权威列表拉回来
    expect(
      mergeHiddenDisabledTools([{ serverId: "srv-a", disabledTools: ["write"] }], groups, {
        "srv-a": ["search", "write"],
      }),
    ).toEqual([{ serverId: "srv-a", disabledTools: ["write"] }]);
  });

  it("leaves enabled-only patches and unknown baselines untouched", () => {
    const groups = [group()];
    expect(
      mergeHiddenDisabledTools([{ serverId: "srv-a", enabled: false }], groups, {
        "srv-a": ["retired"],
      }),
    ).toEqual([{ serverId: "srv-a", enabled: false }]);
    expect(
      mergeHiddenDisabledTools([{ serverId: "srv-a", disabledTools: [] }], groups, {}),
    ).toEqual([{ serverId: "srv-a", disabledTools: [] }]);
  });
});
