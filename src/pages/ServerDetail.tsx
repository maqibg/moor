import { useApi } from "@/hooks/useApi";
import { useServers } from "@/hooks/useServers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Play, Square, RefreshCw } from "lucide-react";

interface ServerDetailData {
  id: string;
  name: string;
  connection_type: "stdio" | "http";
  command: string | null;
  args: string[] | null;
  url: string | null;
  env: Record<string, string> | null;
  working_dir: string | null;
  status: string;
  error_message: string | null;
}

export function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { startServer, stopServer } = useServers();
  const { data: server, loading, refresh } = useApi<ServerDetailData>(`/api/servers/${id}`, {} as ServerDetailData);
  const { data: tools, refresh: refreshTools } = useApi<Array<{ tool_name: string; description: string | null }>>(`/api/servers/${id}/tools`, []);

  if (loading || !server?.id) {
    return <p className="font-body text-sm text-[rgba(38,37,30,0.4)] py-8 text-center">Loading...</p>;
  }

  const handleDiscoverTools = async () => {
    if (server.status === "running") {
      await stopServer(id!);
      await startServer(id!);
    } else {
      await startServer(id!);
    }
    refreshTools();
    refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/servers")}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="font-headline text-2xl tracking-tight text-cursor-dark">{server.name}</h1>
            <StatusBadge status={server.status} />
          </div>
          <p className="font-mono text-xs text-[rgba(38,37,30,0.4)] mt-0.5">
            {server.connection_type === "stdio"
              ? `${server.command || ""} ${server.args?.join(" ") || ""}`
              : server.url || ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {server.status === "running" ? (
            <Button variant="outline" onClick={() => { stopServer(id!); refresh(); }}><Square className="h-4 w-4 mr-2" /> Stop</Button>
          ) : (
            <Button onClick={() => { startServer(id!); refresh(); }}><Play className="h-4 w-4 mr-2" /> Start</Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="font-headline text-xs text-[rgba(38,37,30,0.55)] mb-1 block">Connection Type</label>
              <Badge variant="outline">{server.connection_type}</Badge>
            </div>
            {server.working_dir && (
              <div>
                <label className="font-headline text-xs text-[rgba(38,37,30,0.55)] mb-1 block">Working Directory</label>
                <p className="font-mono text-xs text-[rgba(38,37,30,0.55)]">{server.working_dir}</p>
              </div>
            )}
          </div>
          {server.env && Object.keys(server.env).length > 0 && (
            <div>
              <label className="font-headline text-xs text-[rgba(38,37,30,0.55)] mb-1 block">Environment</label>
              <pre className="font-mono text-xs bg-surface-300 rounded-lg p-3 text-[rgba(38,37,30,0.7)]">{JSON.stringify(server.env, null, 2)}</pre>
            </div>
          )}
          {server.error_message && (
            <div>
              <label className="font-headline text-xs text-error-warm mb-1 block">Error</label>
              <p className="font-body text-sm text-error-warm">{server.error_message}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Discovered Tools ({tools.length})</CardTitle>
            <Button variant="ghost" size="sm" onClick={handleDiscoverTools}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </div>
        </CardHeader>
        <CardContent>
          {tools.length === 0 ? (
            <p className="font-body text-sm text-[rgba(38,37,30,0.4)] py-4 text-center">No tools discovered. Start the server to discover tools.</p>
          ) : (
            <div className="space-y-2">
              {tools.map((tool, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-[rgba(38,37,30,0.06)] last:border-0">
                  <div className="min-w-0">
                    <p className="font-headline text-sm text-cursor-dark">{tool.tool_name}</p>
                    {tool.description && <p className="font-body text-xs text-[rgba(38,37,30,0.55)] mt-0.5 truncate">{tool.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
