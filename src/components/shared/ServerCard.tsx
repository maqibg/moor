import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import { Play, Square, Trash2, Settings, Terminal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Server } from "@/hooks/useServers";
import { cn } from "@/lib/utils";

export function ServerCard({
  server,
  onStart,
  onStop,
  onRemove,
}: {
  server: Server;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const navigate = useNavigate();

  const isRunning = server.status === "running";
  const isError = server.status === "error";
  const isStarting = server.status === "starting";

  const commandPreview =
    server.connection_type === "stdio"
      ? `${server.command || ""} ${(server.args || []).join(" ")}`.trim()
      : server.url || "";

  return (
    <Card
      className={cn(
        "group transition-all duration-200 hover:shadow-[rgba(0,0,0,0.04)_0px_12px_40px,rgba(0,0,0,0.02)_0px_0px_16px]",
        isRunning && "border-l-[3px] border-l-success-muted",
        isError && "border-l-[3px] border-l-error-warm",
        isStarting && "border-l-[3px] border-l-gold",
        !isRunning &&
          !isError &&
          !isStarting &&
          "border-l-[3px] border-l-transparent hover:border-l-[rgba(38,37,30,0.1)]",
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-200",
                isRunning
                  ? "bg-success-muted/10 text-success-muted border border-success-muted/20"
                  : isError
                    ? "bg-error-warm/10 text-error-warm border border-error-warm/20"
                    : "bg-surface-300 text-[rgba(38,37,30,0.35)] border border-[rgba(38,37,30,0.08)]",
              )}
            >
              <Terminal className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-headline text-sm font-medium text-cursor-dark truncate">
                  {server.name}
                </span>
                <StatusBadge status={server.status} />
              </div>
              {commandPreview && (
                <p className="font-mono text-[11px] text-[rgba(38,37,30,0.4)] truncate">
                  {commandPreview}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            {isRunning ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-[rgba(38,37,30,0.45)] hover:text-error-warm"
                onClick={() => onStop(server.id)}
                title="Stop server"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-[rgba(38,37,30,0.45)] hover:text-success-muted"
                onClick={() => onStart(server.id)}
                title="Start server"
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[rgba(38,37,30,0.45)] hover:text-cursor-dark"
              onClick={() => navigate(`/servers/${server.id}`)}
              title="Server details"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[rgba(38,37,30,0.35)] hover:text-error-warm"
              onClick={() => onRemove(server.id)}
              title="Remove server"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
