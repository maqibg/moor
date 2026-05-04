import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Play, Square, RefreshCw, Copy, Check, Terminal } from "lucide-react";
import { useProfiles } from "@/hooks/useProfiles";
import { useServers } from "@/hooks/useServers";
import { cn } from "@/lib/utils";

interface ServerDetailData {
  id: string;
  name: string;
  connection_type: "stdio" | "http";
  command: string | null;
  args: string[] | null;
  url: string | null;
  env: Record<string, string> | null;
  headers: Record<string, string> | null;
  working_dir: string | null;
  auto_start: boolean;
  status: string;
  error_message: string | null;
}

interface ToolDetail {
  tool_name: string;
  exposed_name: string;
  description: string | null;
  input_schema: unknown;
  disabled: boolean;
}

export function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { startServer, stopServer, updateServer } = useServers();
  const { profiles, updateProfileServer } = useProfiles();
  const activeProfile = profiles.find((profile) => profile.is_active);

  const { data: server, isLoading: loading } = useQuery<ServerDetailData>({
    queryKey: ["servers", id],
    queryFn: () => api<ServerDetailData>(`/api/servers/${id}`),
    enabled: !!id,
  });

  const { data: tools = [] } = useQuery<ToolDetail[]>({
    queryKey: ["servers", id, "tools", activeProfile?.id],
    queryFn: () =>
      api<ToolDetail[]>(
        `/api/servers/${id}/tools${activeProfile ? `?profile_id=${activeProfile.id}` : ""}`,
      ),
    enabled: !!id,
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["servers", id] }),
    [queryClient, id],
  );

  const refreshTools = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["servers", id, "tools"] }),
    [queryClient, id],
  );

  const [copied, setCopied] = useState(false);

  if (loading || !server?.id) {
    return (
      <div className="py-16 text-center animate-fade-in">
        <div className="h-8 w-8 mx-auto rounded-full border-2 border-[rgba(38,37,30,0.1)] border-t-cursor-orange animate-spin mb-4" />
        <p className="font-body text-sm text-[rgba(38,37,30,0.4)]">Loading server details...</p>
      </div>
    );
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

  const toggleTool = async (toolName: string, enabled: boolean) => {
    if (!activeProfile || !id) return;
    const disabledTools = new Set(
      tools.filter((tool) => tool.disabled).map((tool) => tool.tool_name),
    );
    if (enabled) {
      disabledTools.delete(toolName);
    } else {
      disabledTools.add(toolName);
    }
    await updateProfileServer(activeProfile.id, id, { disabledTools: Array.from(disabledTools) });
    refreshTools();
  };

  const toggleAutoStart = async (value: boolean) => {
    if (!id) return;
    try {
      await updateServer({ id, updates: { autoStart: value } });
    } catch {
      // 请求失败时 refresh 会还原 Switch 状态
    }
  };

  const commandText =
    server.connection_type === "stdio"
      ? `${server.command || ""} ${server.args?.join(" ") || ""}`.trim()
      : server.url || "";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(commandText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const envEntries = server.env ? Object.entries(server.env) : [];
  const headerEntries = server.headers ? Object.entries(server.headers) : [];

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" className="mt-0.5" onClick={() => navigate("/servers")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div
              className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center border shrink-0",
                server.status === "running"
                  ? "bg-success-muted/10 text-success-muted border-success-muted/20"
                  : server.status === "error"
                    ? "bg-error-warm/10 text-error-warm border-error-warm/20"
                    : "bg-surface-300 text-[rgba(38,37,30,0.35)] border-[rgba(38,37,30,0.08)]",
              )}
            >
              <Terminal className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="font-headline text-[22px] tracking-tight text-cursor-dark">
                  {server.name}
                </h1>
                <StatusBadge status={server.status} />
              </div>
              <p className="font-mono text-[11px] text-[rgba(38,37,30,0.4)] mt-0.5 truncate">
                {commandText || "No command configured"}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {server.status === "running" ? (
            <Button
              variant="outline"
              onClick={() => {
                stopServer(id!);
                refresh();
              }}
            >
              <Square className="h-4 w-4 mr-2" /> Stop
            </Button>
          ) : (
            <Button
              onClick={() => {
                startServer(id!);
                refresh();
              }}
            >
              <Play className="h-4 w-4 mr-2" /> Start
            </Button>
          )}
        </div>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Command Preview */}
          {commandText && (
            <div>
              <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-2 block uppercase tracking-wider">
                {server.connection_type === "stdio" ? "Command" : "URL"}
              </label>
              <div className="bg-cursor-dark rounded-xl border border-[rgba(38,37,30,0.15)] p-4 relative group">
                <pre className="font-mono text-xs text-[rgba(242,241,237,0.85)] overflow-x-auto whitespace-pre-wrap pr-10">
                  {commandText}
                </pre>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-2.5 right-2.5 text-[rgba(242,241,237,0.4)] hover:text-[rgba(242,241,237,0.8)] hover:bg-white/10"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-success-muted" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-1.5 block">
                Connection Type
              </label>
              <Badge variant="outline" className="capitalize">
                {server.connection_type}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-1.5 block">
                  Auto Start
                </label>
                <p className="text-[11px] text-[rgba(38,37,30,0.4)]">Moor 启动时自动启动</p>
              </div>
              <Switch
                checked={server.auto_start}
                onCheckedChange={(v) => void toggleAutoStart(v)}
              />
            </div>
            {server.working_dir && (
              <div className="col-span-2">
                <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-1.5 block">
                  Working Directory
                </label>
                <p className="font-mono text-xs text-[rgba(38,37,30,0.55)] bg-surface-300 rounded-lg px-3 py-2">
                  {server.working_dir}
                </p>
              </div>
            )}
          </div>

          {envEntries.length > 0 && (
            <div>
              <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-2 block">
                Environment Variables
              </label>
              <div className="rounded-xl border border-[rgba(38,37,30,0.08)] overflow-hidden">
                <div className="flex items-center px-4 py-2 border-b border-[rgba(38,37,30,0.06)] bg-surface-300/50">
                  <span className="font-mono text-[10px] text-[rgba(38,37,30,0.4)] w-1/3 uppercase tracking-wider">
                    Key
                  </span>
                  <span className="font-mono text-[10px] text-[rgba(38,37,30,0.4)] w-2/3 uppercase tracking-wider">
                    Value
                  </span>
                </div>
                {envEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center px-4 py-2.5 border-b border-[rgba(38,37,30,0.04)] last:border-0 hover:bg-surface-300/30 transition-colors"
                  >
                    <span className="font-mono text-xs text-cursor-dark w-1/3 truncate">{key}</span>
                    <span className="font-mono text-xs text-[rgba(38,37,30,0.5)] w-2/3 truncate">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {headerEntries.length > 0 && (
            <div>
              <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-2 block">
                HTTP Headers
              </label>
              <div className="rounded-xl border border-[rgba(38,37,30,0.08)] overflow-hidden">
                <div className="flex items-center px-4 py-2 border-b border-[rgba(38,37,30,0.06)] bg-surface-300/50">
                  <span className="font-mono text-[10px] text-[rgba(38,37,30,0.4)] w-1/3 uppercase tracking-wider">
                    Header
                  </span>
                  <span className="font-mono text-[10px] text-[rgba(38,37,30,0.4)] w-2/3 uppercase tracking-wider">
                    Value
                  </span>
                </div>
                {headerEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center px-4 py-2.5 border-b border-[rgba(38,37,30,0.04)] last:border-0 hover:bg-surface-300/30 transition-colors"
                  >
                    <span className="font-mono text-xs text-cursor-dark w-1/3 truncate">{key}</span>
                    <span className="font-mono text-xs text-[rgba(38,37,30,0.5)] w-2/3 truncate">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {server.error_message && (
            <div className="rounded-xl bg-error-warm/8 border border-error-warm/20 p-4">
              <label className="font-headline text-xs text-error-warm mb-1.5 block">Error</label>
              <p className="font-mono text-xs text-error-warm">{server.error_message}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tools */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Discovered Tools</CardTitle>
              <Badge variant="subtle">{tools.length}</Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={handleDiscoverTools}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {tools.length === 0 ? (
            <div className="py-10 text-center">
              <Terminal className="h-8 w-8 mx-auto text-[rgba(38,37,30,0.15)] mb-3" />
              <p className="font-body text-sm text-[rgba(38,37,30,0.35)]">
                No tools discovered. Start the server to discover tools.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {tools.map((tool) => (
                <div
                  key={tool.tool_name}
                  className={cn(
                    "flex items-center justify-between p-4 rounded-xl border transition-all duration-200",
                    tool.disabled
                      ? "bg-surface-300/40 border-[rgba(38,37,30,0.06)] opacity-60"
                      : "bg-surface-100 border-[rgba(38,37,30,0.08)] hover:border-[rgba(38,37,30,0.15)]",
                  )}
                >
                  <div className="min-w-0 flex-1 mr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[13px] font-medium text-cursor-dark">
                        {tool.exposed_name}
                      </span>
                      <ToolCategoryBadge name={tool.exposed_name} />
                    </div>
                    {tool.description && (
                      <p className="font-body text-xs text-[rgba(38,37,30,0.5)] truncate">
                        {tool.description}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={!tool.disabled}
                    disabled={!activeProfile}
                    onCheckedChange={(v) => toggleTool(tool.tool_name, v)}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ToolCategoryBadge({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("read") || lower.includes("get") || lower.includes("fetch")) {
    return (
      <Badge variant="subtle" className="text-[10px] bg-read/15 text-read border-read/20">
        Read
      </Badge>
    );
  }
  if (
    lower.includes("write") ||
    lower.includes("edit") ||
    lower.includes("update") ||
    lower.includes("create")
  ) {
    return (
      <Badge variant="subtle" className="text-[10px] bg-edit/15 text-edit border-edit/20">
        Edit
      </Badge>
    );
  }
  if (
    lower.includes("search") ||
    lower.includes("find") ||
    lower.includes("list") ||
    lower.includes("grep")
  ) {
    return (
      <Badge variant="subtle" className="text-[10px] bg-grep/15 text-grep border-grep/20">
        Search
      </Badge>
    );
  }
  if (lower.includes("delete") || lower.includes("remove") || lower.includes("destroy")) {
    return (
      <Badge
        variant="subtle"
        className="text-[10px] bg-error-warm/10 text-error-warm border-error-warm/15"
      >
        Destructive
      </Badge>
    );
  }
  return (
    <Badge variant="subtle" className="text-[10px]">
      Tool
    </Badge>
  );
}
