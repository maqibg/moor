import { describe, expect, it } from "vite-plus/test";
import {
  SLOW_P95_MS,
  formatMs,
  formatRate,
  isToolErrorProne,
  isToolSlow,
  windowFromDate,
} from "./insights";
import type { ToolInsight } from "@moor/types";

function tool(overrides: Partial<ToolInsight> = {}): ToolInsight {
  return {
    toolName: "search",
    serverId: "server-a",
    serverName: "Alpha",
    callCount: 10,
    errorCount: 0,
    errorRate: 0,
    avgDurationMs: 20,
    p50Ms: 20,
    p95Ms: 30,
    lastCalledAt: "2026-01-01T00:00:00.000000000Z",
    ...overrides,
  };
}

describe("insights governance thresholds", () => {
  it("flags error-prone tools only from five calls onwards", () => {
    expect(isToolErrorProne(tool({ callCount: 4, errorRate: 0.5 }))).toBe(false);
    expect(isToolErrorProne(tool({ callCount: 5, errorRate: 0.19 }))).toBe(false);
    expect(isToolErrorProne(tool({ callCount: 5, errorRate: 0.2 }))).toBe(true);
  });

  it("flags slow tools by p95 and ignores missing durations", () => {
    expect(isToolSlow(tool({ p95Ms: SLOW_P95_MS - 1 }))).toBe(false);
    expect(isToolSlow(tool({ p95Ms: SLOW_P95_MS }))).toBe(true);
    expect(isToolSlow(tool({ p95Ms: null }))).toBe(false);
  });

  it("formats durations and rates for display", () => {
    expect(formatMs(null)).toBe("—");
    expect(formatMs(999)).toBe("999ms");
    expect(formatMs(1500)).toBe("1.5s");
    expect(formatRate(0.125)).toBe("12.5%");
  });

  it("maps windows to a lower bound and leaves all unbounded", () => {
    const day = windowFromDate("24h");
    expect(day).toBeDefined();
    const dayMs = Date.parse(day as string);
    expect(Date.now() - dayMs).toBeGreaterThan(23 * 3600 * 1000);
    expect(Date.now() - dayMs).toBeLessThan(25 * 3600 * 1000);
    expect(windowFromDate("all")).toBeUndefined();

    const month = Date.parse(windowFromDate("30d") as string);
    const week = Date.parse(windowFromDate("7d") as string);
    expect(month).toBeLessThan(week);
  });
});
