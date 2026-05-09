import { getAuditLogRepository } from "../db/audit-log-repository.js";
import { redactForAudit } from "./audit-redaction.js";
import { settingsService } from "./settings.js";

interface LogEntry {
  id: string;
  timestamp: string;
  profileId: string | null;
  serverId: string | null;
  toolName: string;
  arguments: unknown;
  result: unknown | null;
  error: string | null;
  durationMs: number;
  agentInfo: string | null;
}

const FLUSH_INTERVAL_MS = 500;
const MAX_BUFFER_SIZE = 50;

export class AuditLogger {
  private buffer: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  start() {
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  log(entry: Omit<LogEntry, "id" | "timestamp">) {
    try {
      const settings = settingsService.getSettings();
      if (!settings.advanced.enableAuditLogging) return;
    } catch {
      // settingsService not initialized yet, allow logging
    }
    this.buffer.push({
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    });
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.flush();
    }
  }

  flush() {
    if (this.buffer.length === 0) return;
    const entries = this.buffer.splice(0);
    try {
      const repo = getAuditLogRepository();
      for (const entry of entries) {
        repo.insert({
          id: entry.id,
          timestamp: entry.timestamp,
          profileId: entry.profileId,
          serverId: entry.serverId,
          toolName: entry.toolName,
          arguments: redactForAudit(entry.arguments),
          result: entry.result !== null ? redactForAudit(entry.result) : null,
          error: entry.error,
          durationMs: entry.durationMs,
          agentInfo: entry.agentInfo,
        });
      }
    } catch (err) {
      console.error("AuditLogger flush error:", err);
      this.buffer.unshift(...entries);
    }
  }

  drain(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    return Promise.resolve();
  }
}

let _instance: AuditLogger | null = null;

export function initAuditLogger(): AuditLogger {
  _instance = new AuditLogger();
  return _instance;
}

export function getAuditLogger(): AuditLogger {
  if (!_instance) throw new Error("AuditLogger not initialized");
  return _instance;
}
