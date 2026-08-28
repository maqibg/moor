import { describe, expect, it } from "vite-plus/test";
import { formatMs, isToolErrorProne, isToolSlow, windowFromDate } from "./insights";
import type { ToolInsight } from "@moor/types";

function tool(overrides: Partial<ToolInsight>): ToolInsight {
  return {
    toolName: "search",
    serverId: "s1",
    serverName: "Alpha",
    callCount: 10,
    errorCount: 0,
    errorRate: 0,
    avgDurationMs: 100,
    p50Ms: 100,
    p95Ms: 200,
    lastCalledAt: null,
    ...overrides,
  };
}

describe("isToolErrorProne", () => {
  it("flags tools with sustained error rate over threshold", () => {
    expect(isToolErrorProne(tool({ callCount: 10, errorCount: 3, errorRate: 0.3 }))).toBe(true);
  });

  it("ignores error rate on low-volume tools to avoid noise from flukes", () => {
    // 意图：偶发一次失败的新工具不应进入治理候选，否则面板会被误报淹没
    expect(isToolErrorProne(tool({ callCount: 2, errorCount: 1, errorRate: 0.5 }))).toBe(false);
  });
});

describe("isToolSlow", () => {
  it("flags only when p95 crosses the threshold", () => {
    expect(isToolSlow(tool({ p95Ms: 6000 }))).toBe(true);
    expect(isToolSlow(tool({ p95Ms: 4999 }))).toBe(false);
    expect(isToolSlow(tool({ p95Ms: null }))).toBe(false);
  });
});

describe("formatMs", () => {
  it("renders seconds above 1s and milliseconds below", () => {
    expect(formatMs(1500)).toBe("1.5s");
    expect(formatMs(120)).toBe("120ms");
    expect(formatMs(null)).toBe("—");
  });
});

describe("windowFromDate", () => {
  it("returns undefined for all-time window", () => {
    expect(windowFromDate("all")).toBeUndefined();
  });

  it("computes a past ISO timestamp for bounded windows", () => {
    const from = windowFromDate("24h")!;
    const diffHours = (Date.now() - new Date(from).getTime()) / 3600 / 1000;
    expect(diffHours).toBeGreaterThan(23.9);
    expect(diffHours).toBeLessThan(24.1);
  });
});
