import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useServers } from "@/hooks/useServers";
import { useProfiles } from "@/hooks/useProfiles";
import { useLogs } from "@/hooks/useLogs";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Server, FolderOpen, Activity, AlertTriangle } from "lucide-react";
import { useSSE } from "@/hooks/useSSE";
import { useCallback } from "react";

export function Dashboard() {
  const { servers, refresh: refreshServers } = useServers();
  const { profiles } = useProfiles();
  const { logs, refresh: refreshLogs } = useLogs();

  useSSE(
    useCallback(
      (event) => {
        if (event.type === "server:status" || event.type === "server:tools") refreshServers();
        if (event.type === "profile:activated") {
          refreshServers();
          refreshLogs();
        }
      },
      [refreshServers, refreshLogs],
    ),
  );

  const running = servers.filter((s) => s.status === "running").length;
  const stopped = servers.filter((s) => s.status === "stopped").length;
  const errored = servers.filter((s) => s.status === "error").length;
  const activeProfile = profiles.find((p) => p.is_active);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline text-2xl tracking-tight text-cursor-dark">Dashboard</h1>
        <p className="font-body text-sm text-[rgba(38,37,30,0.55)] mt-1">
          Moor MCP Manager overview
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-success-muted/15 flex items-center justify-center">
              <Server className="h-5 w-5 text-success-muted" />
            </div>
            <div>
              <p className="font-headline text-2xl text-cursor-dark">{running}</p>
              <p className="font-body text-xs text-[rgba(38,37,30,0.55)]">Running</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-surface-300 flex items-center justify-center">
              <Server className="h-5 w-5 text-[rgba(38,37,30,0.4)]" />
            </div>
            <div>
              <p className="font-headline text-2xl text-cursor-dark">{stopped}</p>
              <p className="font-body text-xs text-[rgba(38,37,30,0.55)]">Stopped</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-error-warm/15 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-error-warm" />
            </div>
            <div>
              <p className="font-headline text-2xl text-cursor-dark">{errored}</p>
              <p className="font-body text-xs text-[rgba(38,37,30,0.55)]">Errors</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-cursor-orange/15 flex items-center justify-center">
              <FolderOpen className="h-5 w-5 text-cursor-orange" />
            </div>
            <div>
              <p className="font-headline text-2xl text-cursor-dark">
                {activeProfile?.name || "—"}
              </p>
              <p className="font-body text-xs text-[rgba(38,37,30,0.55)]">Active Profile</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Servers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {servers.length === 0 ? (
              <p className="font-body text-sm text-[rgba(38,37,30,0.4)] py-4 text-center">
                No servers configured
              </p>
            ) : (
              servers.slice(0, 5).map((server) => (
                <div key={server.id} className="flex items-center justify-between py-1.5">
                  <span className="font-headline text-sm text-cursor-dark">{server.name}</span>
                  <StatusBadge status={server.status} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {logs.length === 0 ? (
              <p className="font-body text-sm text-[rgba(38,37,30,0.4)] py-4 text-center">
                No recent activity
              </p>
            ) : (
              logs.slice(0, 5).map((log) => (
                <div key={log.id} className="flex items-center justify-between py-1.5">
                  <div className="min-w-0">
                    <span className="font-headline text-sm text-cursor-dark">{log.tool_name}</span>
                    {log.error && <span className="text-error-warm text-xs ml-2">failed</span>}
                  </div>
                  <span className="font-mono text-[10px] text-[rgba(38,37,30,0.35)] shrink-0">
                    {log.duration_ms ? `${log.duration_ms}ms` : "—"}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
