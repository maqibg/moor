import type { ToolInsight } from "@moor/types";

/** 高亮阈值：错误率 ≥20% 或 p95 ≥5s 视为治理候选（关掉或修掉）。 */
export const ERROR_RATE_ALERT = 0.2;
export const SLOW_P95_MS = 5000;

export function isToolErrorProne(tool: ToolInsight): boolean {
  // 低频工具的偶然失败不该刷红——至少 5 次调用才参与错误率判定
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

/** 窗口 → from ISO 参数；all 返回 undefined（后端不过滤）。 */
export function windowFromDate(window: InsightsWindow): string | undefined {
  if (window === "all") return undefined;
  const hours = window === "24h" ? 24 : window === "7d" ? 24 * 7 : 24 * 30;
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}
