import { useState, Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLogs, useLogStats } from "@/hooks/useLogs";
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

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  delay,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent: string;
  delay: number;
}) {
  return (
    <Card className={cn("animate-fade-in-up", `stagger-${delay}`)}>
      <CardContent className="p-5">
        <div className="flex justify-between items-start mb-3">
          <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center border", accent)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="font-headline text-[28px] font-medium tracking-tight text-cursor-dark leading-none">
          {value}
        </p>
        <p className="font-body text-xs text-[rgba(38,37,30,0.45)] mt-1.5">{label}</p>
      </CardContent>
    </Card>
  );
}

export function AuditLogs() {
  const [toolFilter, setToolFilter] = useState("");
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const { logs, refresh } = useLogs(toolFilter ? { tool_name: toolFilter } : undefined);
  const { stats, refresh: refreshStats } = useLogStats();

  const handleRefresh = () => {
    refresh();
    refreshStats();
  };

  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-headline text-[28px] tracking-tight text-cursor-dark leading-tight">
            Audit Logs
          </h1>
          <p className="font-body text-sm text-[rgba(38,37,30,0.5)] mt-1.5">
            Tool call history and statistics
          </p>
        </div>
        <Button variant="outline" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Activity}
          label="Total Calls"
          value={stats.totalCalls.toString()}
          accent="bg-[rgba(38,37,30,0.06)] text-[rgba(38,37,30,0.5)] border-[rgba(38,37,30,0.1)]"
          delay={1}
        />
        <StatCard
          icon={AlertTriangle}
          label="Errors"
          value={stats.errorCalls.toString()}
          accent="bg-error-warm/10 text-error-warm border-error-warm/20"
          delay={2}
        />
        <StatCard
          icon={Zap}
          label="Error Rate"
          value={`${(stats.errorRate * 100).toFixed(1)}%`}
          accent={
            stats.errorRate > 0.1
              ? "bg-error-warm/10 text-error-warm border-error-warm/20"
              : "bg-success-muted/10 text-success-muted border-success-muted/20"
          }
          delay={3}
        />
        <StatCard
          icon={Clock}
          label="Avg Duration"
          value={stats.avgDurationMs ? `${Math.round(stats.avgDurationMs)}ms` : "—"}
          accent="bg-read/10 text-read border-read/15"
          delay={4}
        />
      </div>

      {/* Top Tools */}
      {stats.topTools.length > 0 && (
        <Card className="animate-fade-in-up stagger-5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-[rgba(38,37,30,0.4)]" /> Top Tools
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.topTools.map((t) => (
                <Badge key={t.tool_name} variant="subtle" className="text-xs">
                  {t.tool_name} <span className="text-[rgba(38,37,30,0.4)] ml-1">({t.count})</span>
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[rgba(38,37,30,0.3)]" />
            <Input
              placeholder="Filter by tool name..."
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
              className="pl-9"
            />
          </div>
          {toolFilter && (
            <Button variant="ghost" size="sm" onClick={() => setToolFilter("")}>
              Clear
            </Button>
          )}
        </div>

        <Card>
          <ScrollArea className="max-h-[520px]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(38,37,30,0.08)]">
                  <th className="text-left font-headline text-[11px] text-[rgba(38,37,30,0.45)] uppercase tracking-wider px-4 py-2.5 font-medium">
                    Time
                  </th>
                  <th className="text-left font-headline text-[11px] text-[rgba(38,37,30,0.45)] uppercase tracking-wider px-4 py-2.5 font-medium">
                    Tool
                  </th>
                  <th className="text-left font-headline text-[11px] text-[rgba(38,37,30,0.45)] uppercase tracking-wider px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th className="text-left font-headline text-[11px] text-[rgba(38,37,30,0.45)] uppercase tracking-wider px-4 py-2.5 font-medium">
                    Duration
                  </th>
                  <th className="text-left font-headline text-[11px] text-[rgba(38,37,30,0.45)] uppercase tracking-wider px-4 py-2.5 font-medium">
                    Agent
                  </th>
                  <th className="w-10 px-2" />
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="font-body text-sm text-[rgba(38,37,30,0.35)] py-10 text-center"
                    >
                      <Clock className="h-8 w-8 mx-auto text-[rgba(38,37,30,0.12)] mb-3" />
                      No log entries
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <Fragment key={log.id}>
                      <tr
                        className="border-b border-[rgba(38,37,30,0.04)] hover:bg-surface-300/40 cursor-pointer transition-colors"
                        onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                      >
                        <td className="px-4 py-2.5 font-mono text-[11px] text-[rgba(38,37,30,0.45)]">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-2.5 font-headline text-sm text-cursor-dark">
                          {log.tool_name}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={log.error ? "error" : "success"} className="text-[10px]">
                            {log.error ? "Error" : "Success"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-[rgba(38,37,30,0.45)]">
                          {log.duration_ms ? `${log.duration_ms}ms` : "—"}
                        </td>
                        <td className="px-4 py-2.5 font-body text-[11px] text-[rgba(38,37,30,0.35)] truncate max-w-[120px]">
                          {log.agent_info || "—"}
                        </td>
                        <td className="px-2">
                          {expandedLog === log.id ? (
                            <ChevronDown className="h-3.5 w-3.5 text-[rgba(38,37,30,0.35)]" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-[rgba(38,37,30,0.35)]" />
                          )}
                        </td>
                      </tr>
                      {expandedLog === log.id && (
                        <tr>
                          <td colSpan={6} className="px-4 py-4 bg-surface-300/30 animate-fade-in">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {log.arguments != null && (
                                <div>
                                  <p className="font-headline text-[11px] text-[rgba(38,37,30,0.5)] mb-1.5 uppercase tracking-wider">
                                    Arguments
                                  </p>
                                  <pre className="font-mono text-[11px] bg-surface-100 rounded-xl p-3 text-[rgba(38,37,30,0.7)] overflow-auto max-h-40 border border-[rgba(38,37,30,0.06)]">
                                    {JSON.stringify(log.arguments, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {(log.result || log.error) && (
                                <div>
                                  <p className="font-headline text-[11px] text-[rgba(38,37,30,0.5)] mb-1.5 uppercase tracking-wider">
                                    {log.error ? "Error" : "Result"}
                                  </p>
                                  <pre
                                    className={cn(
                                      "font-mono text-[11px] rounded-xl p-3 overflow-auto max-h-40 border",
                                      log.error
                                        ? "bg-error-warm/5 text-error-warm border-error-warm/10"
                                        : "bg-surface-100 text-[rgba(38,37,30,0.7)] border-[rgba(38,37,30,0.06)]",
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
                  ))
                )}
              </tbody>
            </table>
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
