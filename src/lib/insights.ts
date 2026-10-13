import type { ToolInsight } from "@moor/types";

/** Governance thresholds: an error rate ≥20% or p95 ≥5s marks a tool to fix or disable. */
export const ERROR_RATE_ALERT = 0.2;
export const SLOW_P95_MS = 5000;

/** A low-traffic tool's occasional failure should not flag it: at least 5 calls. */
export function isToolErrorProne(tool: ToolInsight): boolean {
  return tool.callCount >= 5 && tool.errorRate >= ERROR_RATE_ALERT;
}

export function isToolSlow(tool: ToolInsight): boolean {
  return tool.p95Ms != null && tool.p95Ms >= SLOW_P95_MS;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export type InsightsWindow = "24h" | "7d" | "30d" | "all";

/** Window → `from` query parameter; `all` means "no lower bound". */
export function windowFromDate(window: InsightsWindow): string | undefined {
  if (window === "all") return undefined;
  const hours = window === "24h" ? 24 : window === "7d" ? 24 * 7 : 24 * 30;
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}
