import { getAuditLogRepository, type LogStats } from "../db/audit-log-repository.js";
import type { AuditLogRow } from "../db/audit-log-repository.js";

class AuditLogService {
  queryLogs(filters: {
    server_id?: string;
    tool_name?: string;
    from?: string;
    to?: string;
    limit?: string;
    offset?: string;
  }): AuditLogRow[] {
    return getAuditLogRepository().queryLogs(filters);
  }

  getStats(): LogStats {
    return getAuditLogRepository().getStats();
  }
}

export const auditLogService = new AuditLogService();
