import { Fragment, memo, useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInfiniteLogs, useLogStats } from "@/hooks/useLogs";
import { StatCard } from "@/components/shared/StatCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Search,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  BarChart3,
  Activity,
  AlertTriangle,
  Clock,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";
import type { AuditLogEntry } from "@moor/types";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);

  return debouncedValue;
}

const AuditLogRow = memo(function AuditLogRow({
  log,
  expanded,
  onToggle,
}: {
  log: AuditLogEntry;
  expanded: boolean;
  onToggle: (id: string) => void;
}) {
  const { t } = useI18n();

  return (
    <Fragment>
      <tr
        className="border-b border-[var(--fg-04)] hover:bg-surface-300/40 cursor-pointer transition-colors"
        onClick={() => onToggle(log.id)}
      >
        <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--fg-45)]">
          {new Date(log.timestamp).toLocaleTimeString()}
        </td>
        <td className="px-4 py-2.5 font-headline text-sm text-cursor-dark">{log.toolName}</td>
        <td className="px-4 py-2.5">
          <Badge variant={log.error ? "error" : "success"} className="text-[10px]">
            {log.error ? t("Error") : t("Success")}
          </Badge>
        </td>
        <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--fg-45)]">
          {log.durationMs ? `${log.durationMs}ms` : "—"}
        </td>
        <td className="px-4 py-2.5 font-body text-[11px] text-[var(--fg-35)] truncate max-w-[120px]">
          {log.agentInfo || "—"}
        </td>
        <td className="px-2">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-[var(--fg-35)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-[var(--fg-35)]" />
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="px-4 py-4 bg-surface-300/30 animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {log.arguments != null && (
                <div>
                  <p className="font-headline text-[11px] text-[var(--fg-50)] mb-1.5 uppercase tracking-wider">
                    {t("Arguments")}
                  </p>
                  <pre className="font-mono text-[11px] bg-surface-100 rounded-xl p-3 text-[var(--fg-70)] overflow-auto max-h-40 border border-[var(--fg-06)]">
                    {JSON.stringify(log.arguments, null, 2)}
                  </pre>
                </div>
              )}
              {(log.result || log.error) && (
                <div>
                  <p className="font-headline text-[11px] text-[var(--fg-50)] mb-1.5 uppercase tracking-wider">
                    {log.error ? t("Error") : t("Result")}
                  </p>
                  <pre
                    className={cn(
                      "font-mono text-[11px] rounded-xl p-3 overflow-auto max-h-40 border",
                      log.error
                        ? "bg-error-warm/5 text-error-warm border-error-warm/10"
                        : "bg-surface-100 text-[var(--fg-70)] border-[var(--fg-06)]",
                    )}
                  >
                    {JSON.stringify(log.error || log.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
});

export function AuditLogs() {
  const { t } = useI18n();
  const [toolFilter, setToolFilter] = useState("");
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const debouncedToolFilter = useDebouncedValue(toolFilter.trim(), 300);
  const { logs, loading, refresh, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteLogs(debouncedToolFilter ? { tool_name: debouncedToolFilter } : undefined);
  const { stats, refresh: refreshStats } = useLogStats();
  const toggleLog = useCallback((id: string) => {
    setExpandedLog((current) => (current === id ? null : id));
  }, []);

  const handleRefresh = () => {
    refresh();
    refreshStats();
  };

  return (
    <div className="space-y-8 animate-fade-in-up">
      <PageHeader
        title={t("Audit Logs")}
        subtitle={t("Tool call history and statistics")}
        action={
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" /> {t("Refresh")}
          </Button>
        }
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Activity}
          label={t("Total Calls")}
          value={stats.totalCalls.toString()}
          accent="bg-[var(--fg-06)] text-[var(--fg-50)] border-[var(--fg-10)]"
          delay={1}
          compact
        />
        <StatCard
          icon={AlertTriangle}
          label={t("Errors")}
          value={stats.errorCalls.toString()}
          accent="bg-error-warm/10 text-error-warm border-error-warm/20"
          delay={2}
          compact
        />
        <StatCard
          icon={Zap}
          label={t("Error Rate")}
          value={`${(stats.errorRate * 100).toFixed(1)}%`}
          accent={
            stats.errorRate > 0.1
              ? "bg-error-warm/10 text-error-warm border-error-warm/20"
              : "bg-success-muted/10 text-success-muted border-success-muted/20"
          }
          delay={3}
          compact
        />
        <StatCard
          icon={Clock}
          label={t("Avg Duration")}
          value={stats.avgDurationMs ? `${Math.round(stats.avgDurationMs)}ms` : "—"}
          accent="bg-read/10 text-read border-read/15"
          delay={4}
          compact
        />
      </div>

      {/* Top Tools */}
      {stats.topTools.length > 0 && (
        <Card className="animate-fade-in-up stagger-5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-[var(--fg-40)]" /> {t("Top Tools")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.topTools.map((t) => (
                <Badge key={t.toolName} variant="subtle" className="text-xs">
                  {t.toolName} <span className="text-[var(--fg-40)] ml-1">({t.count})</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Logs Table */}
      <div className="animate-fade-in-up stagger-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--fg-30)]" />
            <Input
              placeholder={t("Filter by tool name...")}
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
              className="pl-9"
            />
          </div>
          {toolFilter && (
            <Button variant="ghost" size="sm" onClick={() => setToolFilter("")}>
              {t("Clear")}
            </Button>
          )}
        </div>

        <Card>
          <ScrollArea className="max-h-[520px]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--fg-08)]">
                  <th className="text-left font-headline text-[11px] text-[var(--fg-45)] uppercase tracking-wider px-4 py-2.5 font-medium">
                    {t("Time")}
                  </th>
                  <th className="text-left font-headline text-[11px] text-[var(--fg-45)] uppercase tracking-wider px-4 py-2.5 font-medium">
                    {t("Tool")}
                  </th>
                  <th className="text-left font-headline text-[11px] text-[var(--fg-45)] uppercase tracking-wider px-4 py-2.5 font-medium">
                    {t("Status")}
                  </th>
                  <th className="text-left font-headline text-[11px] text-[var(--fg-45)] uppercase tracking-wider px-4 py-2.5 font-medium">
                    {t("Duration")}
                  </th>
                  <th className="text-left font-headline text-[11px] text-[var(--fg-45)] uppercase tracking-wider px-4 py-2.5 font-medium">
                    {t("Agent")}
                  </th>
                  <th className="w-10 px-2" />
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <EmptyState
                        icon={Clock}
                        message={loading ? t("Loading...") : t("No log entries")}
                      />
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <AuditLogRow
                      key={log.id}
                      log={log}
                      expanded={expandedLog === log.id}
                      onToggle={toggleLog}
                    />
                  ))
                )}
              </tbody>
            </table>
          </ScrollArea>
          {hasNextPage && (
            <div className="flex justify-center border-t border-[var(--fg-06)] p-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {isFetchingNextPage ? t("Loading...") : t("Load More")}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
