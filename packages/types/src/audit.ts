export interface AuditLogEntry {
  id: string;
  timestamp: string;
  profileId: string | null;
  serverId: string | null;
  toolName: string;
  arguments: unknown;
  result: unknown | null;
  error: string | null;
  durationMs: number | null;
  agentInfo: string | null;
}

export interface LogStats {
  totalCalls: number;
  errorCalls: number;
  errorRate: number;
  avgDurationMs: number | null;
  topTools: Array<{ toolName: string; count: number; avgDuration: number }>;
  topServers: Array<{ serverId: string; count: number }>;
}
