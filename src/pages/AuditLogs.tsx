import { useState, Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLogs, useLogStats } from "@/hooks/useLogs";
import { Search, ChevronDown, ChevronRight, RefreshCw, BarChart3 } from "lucide-react";

export function AuditLogs() {
  const [toolFilter, setToolFilter] = useState("");
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const { logs, refresh } = useLogs(toolFilter ? { tool_name: toolFilter } : undefined);
  const { stats, refresh: refreshStats } = useLogStats();

  const handleRefresh = () => { refresh(); refreshStats(); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-2xl tracking-tight text-cursor-dark">Audit Logs</h1>
          <p className="font-body text-sm text-[rgba(38,37,30,0.55)] mt-1">Tool call history and statistics</p>
        </div>
        <Button variant="outline" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="font-headline text-xs text-[rgba(38,37,30,0.55)]">Total Calls</p><p className="font-headline text-2xl text-cursor-dark">{stats.totalCalls}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="font-headline text-xs text-[rgba(38,37,30,0.55)]">Errors</p><p className="font-headline text-2xl text-error-warm">{stats.errorCalls}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="font-headline text-xs text-[rgba(38,37,30,0.55)]">Error Rate</p><p className="font-headline text-2xl text-cursor-dark">{(stats.errorRate * 100).toFixed(1)}%</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="font-headline text-xs text-[rgba(38,37,30,0.55)]">Avg Duration</p><p className="font-headline text-2xl text-cursor-dark">{stats.avgDurationMs ? `${Math.round(stats.avgDurationMs)}ms` : "—"}</p></CardContent></Card>
      </div>

      {stats.topTools.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Top Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.topTools.map((t) => (
                <Badge key={t.tool_name} variant="default">{t.tool_name} ({t.count})</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[rgba(38,37,30,0.35)]" />
            <Input placeholder="Filter by tool name..." value={toolFilter} onChange={(e) => setToolFilter(e.target.value)} className="pl-9" />
          </div>
        </div>

        <Card>
          <ScrollArea className="max-h-[500px]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(38,37,30,0.1)]">
                  <th className="text-left font-headline text-xs text-[rgba(38,37,30,0.55)] px-4 py-2">Time</th>
                  <th className="text-left font-headline text-xs text-[rgba(38,37,30,0.55)] px-4 py-2">Tool</th>
                  <th className="text-left font-headline text-xs text-[rgba(38,37,30,0.55)] px-4 py-2">Status</th>
                  <th className="text-left font-headline text-xs text-[rgba(38,37,30,0.55)] px-4 py-2">Duration</th>
                  <th className="text-left font-headline text-xs text-[rgba(38,37,30,0.55)] px-4 py-2">Agent</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan={6} className="font-body text-sm text-[rgba(38,37,30,0.4)] py-8 text-center">No log entries</td></tr>
                ) : logs.map((log) => (
                  <Fragment key={log.id}>
                    <tr
                      className="border-b border-[rgba(38,37,30,0.06)] hover:bg-surface-300/50 cursor-pointer"
                      onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                    >
                      <td className="px-4 py-2 font-mono text-xs text-[rgba(38,37,30,0.55)]">{new Date(log.timestamp).toLocaleTimeString()}</td>
                      <td className="px-4 py-2 font-headline text-sm text-cursor-dark">{log.tool_name}</td>
                      <td className="px-4 py-2"><Badge variant={log.error ? "error" : "success"}>{log.error ? "Error" : "Success"}</Badge></td>
                      <td className="px-4 py-2 font-mono text-xs text-[rgba(38,37,30,0.55)]">{log.duration_ms ? `${log.duration_ms}ms` : "—"}</td>
                      <td className="px-4 py-2 font-body text-xs text-[rgba(38,37,30,0.4)] truncate max-w-32">{log.agent_info || "—"}</td>
                      <td className="px-2">{expandedLog === log.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                    </tr>
                    {expandedLog === log.id && (
                      <tr>
                        <td colSpan={6} className="px-4 py-3 bg-surface-300/30">
                          <div className="grid grid-cols-2 gap-4">
                            {log.arguments != null && (
                              <div>
                                <p className="font-headline text-xs text-[rgba(38,37,30,0.55)] mb-1">Arguments</p>
                                <pre className="font-mono text-xs bg-surface-300 rounded-lg p-2 text-[rgba(38,37,30,0.7)] overflow-auto max-h-40">{JSON.stringify(log.arguments, null, 2)}</pre>
                              </div>
                            )}
                            {(log.result || log.error) && (
                              <div>
                                <p className="font-headline text-xs text-[rgba(38,37,30,0.55)] mb-1">{log.error ? "Error" : "Result"}</p>
                                <pre className={`font-mono text-xs rounded-lg p-2 overflow-auto max-h-40 ${log.error ? "bg-error-warm/10 text-error-warm" : "bg-surface-300 text-[rgba(38,37,30,0.7)]"}`}>{JSON.stringify(log.error || log.result, null, 2)}</pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
