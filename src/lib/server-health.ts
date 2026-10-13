import type { ServerHealth, ServerHealthStatus } from "@moor/types";

/** 与 Rust `settings::MCP_HEALTH_CHECK_INTERVAL_{MIN,MAX}` 对齐；超界后端返回 400 VALIDATION_ERROR。 */
export const MCP_HEALTH_CHECK_INTERVAL_MIN = 30;
export const MCP_HEALTH_CHECK_INTERVAL_MAX = 600;

export type HealthIntervalInputState =
  | { valid: true; seconds: number }
  | { valid: false; message: string };

const intervalInputError = `Enter a whole number between ${MCP_HEALTH_CHECK_INTERVAL_MIN} and ${MCP_HEALTH_CHECK_INTERVAL_MAX}.`;

export function parseHealthIntervalSecondsInput(value: string): HealthIntervalInputState {
  if (!/^\d+$/.test(value.trim())) {
    return { valid: false, message: intervalInputError };
  }
  const seconds = Number(value);
  if (seconds < MCP_HEALTH_CHECK_INTERVAL_MIN || seconds > MCP_HEALTH_CHECK_INTERVAL_MAX) {
    return { valid: false, message: intervalInputError };
  }
  return { valid: true, seconds };
}

/** 按 serverId 就地替换，保持列表顺序稳定，避免每次 SSE 快照都重排卡片。 */
export function mergeServerHealthSnapshot(
  previous: ServerHealth[] | undefined,
  snapshot: ServerHealth,
): ServerHealth[] {
  if (!previous) return [snapshot];
  const index = previous.findIndex((item) => item.serverId === snapshot.serverId);
  if (index < 0) return [...previous, snapshot];
  const next = [...previous];
  next[index] = snapshot;
  return next;
}

export function findServerHealth(
  snapshots: ServerHealth[],
  serverId: string | undefined,
): ServerHealth | undefined {
  if (!serverId) return undefined;
  return snapshots.find((snapshot) => snapshot.serverId === serverId);
}

export function healthStatusLabel(status: ServerHealthStatus): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "unhealthy":
      return "Health check failed";
    case "unsupported":
      return "Health checks unsupported";
    default:
      return "Not checked";
  }
}

export type HealthBadgeVariant = "success" | "error" | "subtle";

export function healthBadgeVariant(status: ServerHealthStatus): HealthBadgeVariant {
  switch (status) {
    case "healthy":
      return "success";
    case "unhealthy":
      return "error";
    default:
      return "subtle";
  }
}

/** `unknown` 与 `unsupported` 不是故障，不显示告警摘要。 */
export function isHealthFailure(status: ServerHealthStatus): boolean {
  return status === "unhealthy";
}

type Translate = (key: string, vars?: Record<string, string>) => string;

/**
 * 失败摘要：连续失败次数 + 后端已脱敏的错误信息（server_manager 记录前会做
 * redact_sensitive_stderr_values）。错误缺失时只保留次数，不编造原因。
 */
export function formatHealthFailureSummary(snapshot: ServerHealth, t: Translate): string {
  const failures = t("{{count}} consecutive failures", {
    count: String(snapshot.consecutiveFailures),
  });
  return snapshot.errorMessage ? `${failures} · ${snapshot.errorMessage}` : failures;
}

/**
 * 侧车把 `{ code, message }` 错误压成 message 字符串（见 lib/api/errors 的 readApiError），
 * 因此这里只能按后端固定文案归一化 404/409；未知错误原样透出，不静默兜底。
 */
export function healthCheckErrorKey(message: string): string {
  switch (message) {
    case "Server not found":
      return "This server no longer exists. Refresh the server list.";
    case "Server is not running":
      return "The server is not running. Start it before checking health.";
    case "Server session changed during the health check":
      return "The server restarted during the health check. Try again.";
    default:
      return message;
  }
}
