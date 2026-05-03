import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useServers } from "@/hooks/useServers";
import { useProfiles } from "@/hooks/useProfiles";
import { useLogs } from "@/hooks/useLogs";
import { getMcpEndpoint } from "@/lib/api";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn } from "@/lib/utils";
import {
  Server,
  FolderOpen,
  Activity,
  AlertTriangle,
  ActivitySquare,
  Copy,
  Check,
  Zap,
  Clock,
  ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  delay,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  accent: string;
  delay: number;
}) {
  return (
    <Card
      className={cn(
        "animate-fade-in-up hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.06)] transition-shadow-smooth",
        `stagger-${delay}`,
      )}
    >
      <CardContent className="p-5">
        <div className="flex justify-between items-start mb-4">
          <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center border", accent)}>
            <Icon className="h-[18px] w-[18px]" />
          </div>
        </div>
        <p className="font-headline text-[32px] font-medium tracking-tight text-cursor-dark leading-none">
          {value}
        </p>
        <p className="font-body text-sm text-[rgba(38,37,30,0.45)] mt-1.5">{label}</p>
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { servers } = useServers();
  const { profiles } = useProfiles();
  const { logs } = useLogs();
  const [copied, setCopied] = useState(false);
  const [mcpEndpoint, setMcpEndpoint] = useState("http://127.0.0.1:9223/mcp");

  useEffect(() => {
    void getMcpEndpoint().then(setMcpEndpoint);
  }, []);

  const running = servers.filter((s) => s.status === "running").length;
  const stopped = servers.filter((s) => s.status === "stopped").length;
  const errored = servers.filter((s) => s.status === "error").length;
  const activeProfile = profiles.find((p) => p.is_active);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mcpEndpoint);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const recentLogs = logs.slice(0, 6);
  const recentServers = servers.slice(0, 5);

  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-headline text-[28px] tracking-tight text-cursor-dark leading-tight">
            Dashboard
          </h1>
          <p className="font-body text-sm text-[rgba(38,37,30,0.5)] mt-1.5">
            Monitor your MCP servers and activity
          </p>
        </div>
      </div>

      {/* Global MCP Endpoint */}
      <Card className="animate-fade-in-up stagger-1 border-[rgba(38,37,30,0.08)] bg-gradient-to-r from-surface-400 to-surface-300/50">
        <CardContent className="p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <div className="h-10 w-10 rounded-full bg-success-muted/15 flex items-center justify-center border border-success-muted/25 shrink-0">
              <Zap className="h-5 w-5 text-success-muted" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-headline text-sm font-medium text-cursor-dark">
                  Global MCP Endpoint
                </span>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-success-muted opacity-50" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success-muted" />
                </span>
                <Badge variant="success">Active</Badge>
              </div>
              <div className="flex items-center gap-2 bg-surface-100 border border-[rgba(38,37,30,0.08)] rounded-lg px-3 py-1.5 font-mono text-xs text-[rgba(38,37,30,0.55)] w-fit">
                {mcpEndpoint}
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="shrink-0 w-full sm:w-auto"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-2 text-success-muted" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" /> Copy URL
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Server}
          label="Running"
          value={running}
          accent="bg-success-muted/10 text-success-muted border-success-muted/20"
          delay={2}
        />
        <StatCard
          icon={ActivitySquare}
          label="Stopped"
          value={stopped}
          accent="bg-[rgba(38,37,30,0.06)] text-[rgba(38,37,30,0.4)] border-[rgba(38,37,30,0.1)]"
          delay={3}
        />
        <StatCard
          icon={AlertTriangle}
          label="Errors"
          value={errored}
          accent="bg-error-warm/10 text-error-warm border-error-warm/20"
          delay={4}
        />
        <StatCard
          icon={FolderOpen}
          label="Active Profile"
          value={activeProfile?.name || "—"}
          accent="bg-cursor-orange/10 text-cursor-orange border-cursor-orange/20"
          delay={5}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Recent Activity */}
        <Card className="lg:col-span-3 animate-fade-in-up stagger-6">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-[rgba(38,37,30,0.4)]" />
              Recent Activity
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/logs")}>
              View All <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </CardHeader>
          <CardContent>
            {recentLogs.length === 0 ? (
              <div className="py-10 text-center">
                <Clock className="h-8 w-8 mx-auto text-[rgba(38,37,30,0.15)] mb-3" />
                <p className="font-body text-sm text-[rgba(38,37,30,0.35)]">No recent activity</p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-surface-300/50 transition-colors cursor-pointer group"
                    onClick={() => navigate("/logs")}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "h-2 w-2 rounded-full shrink-0",
                          log.error ? "bg-error-warm" : "bg-success-muted",
                        )}
                      />
                      <span className="font-headline text-sm text-cursor-dark truncate">
                        {log.tool_name}
                      </span>
                      {log.error && (
                        <Badge variant="error" className="text-[10px]">
                          failed
                        </Badge>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-[rgba(38,37,30,0.35)] shrink-0">
                      {log.duration_ms ? `${log.duration_ms}ms` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Server Status */}
        <Card className="lg:col-span-2 animate-fade-in-up stagger-7">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4 text-[rgba(38,37,30,0.4)]" />
              Server Status
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/servers")}>
              Manage <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </CardHeader>
          <CardContent>
            {recentServers.length === 0 ? (
              <div className="py-10 text-center">
                <Server className="h-8 w-8 mx-auto text-[rgba(38,37,30,0.15)] mb-3" />
                <p className="font-body text-sm text-[rgba(38,37,30,0.35)]">
                  No servers configured
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentServers.map((server) => (
                  <div
                    key={server.id}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface-300/50 transition-colors cursor-pointer group"
                    onClick={() => navigate(`/servers/${server.id}`)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "h-8 w-8 rounded-lg flex items-center justify-center border shrink-0",
                          server.status === "running"
                            ? "bg-success-muted/8 text-success-muted border-success-muted/15"
                            : server.status === "error"
                              ? "bg-error-warm/8 text-error-warm border-error-warm/15"
                              : "bg-surface-300 text-[rgba(38,37,30,0.3)] border-[rgba(38,37,30,0.06)]",
                        )}
                      >
                        <Server className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <span className="font-headline text-sm text-cursor-dark truncate block">
                          {server.name}
                        </span>
                      </div>
                    </div>
                    <StatusBadge status={server.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
