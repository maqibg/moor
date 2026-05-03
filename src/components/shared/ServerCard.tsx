import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import { AlertTriangle, Loader2, Play, Settings, Square, Terminal, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Server } from "@/hooks/useServers";
import type { ServerAction } from "@/hooks/useServersState";
import { cn } from "@/lib/utils";

interface ServerCardProps {
  server: Server;
  action?: ServerAction;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

function getCommandPreview(server: Server): string {
  return server.connection_type === "stdio"
    ? `${server.command || ""} ${(server.args || []).join(" ")}`.trim()
    : server.url || "";
}

function ServerAvatar({ isRunning, isError }: { isRunning: boolean; isError: boolean }) {
  return (
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
  );
}

function ServerIdentity({
  server,
  commandPreview,
  displayStatus,
}: {
  server: Server;
  commandPreview: string;
  displayStatus: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="font-headline text-sm font-medium text-cursor-dark truncate">
          {server.name}
        </span>
        <StatusBadge status={displayStatus} />
      </div>
      {commandPreview && (
        <p className="font-mono text-[11px] text-[rgba(38,37,30,0.4)] truncate">{commandPreview}</p>
      )}
    </div>
  );
}

function LifecycleButton({
  serverId,
  isRunning,
  isStarting,
  isStopping,
  isBusy,
  onStart,
  onStop,
}: {
  serverId: string;
  isRunning: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isBusy: boolean;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
}) {
  if (isRunning) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="text-[rgba(38,37,30,0.45)] hover:text-error-warm hover:bg-error-warm/10 active:bg-error-warm/20 transition-all duration-150"
        disabled={isBusy}
        onClick={() => void onStop(serverId)}
        title={isStopping ? "Stopping server" : "Stop server"}
      >
        {isStopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-[rgba(38,37,30,0.45)] hover:text-success-muted hover:bg-success-muted/10 active:bg-success-muted/20 transition-all duration-150"
      disabled={isBusy}
      onClick={() => void onStart(serverId)}
      title={isStarting ? "Starting server" : "Start server"}
    >
      {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
    </Button>
  );
}

function ServerControls({
  server,
  isStarting,
  isStopping,
  isBusy,
  onStart,
  onStop,
  onRemove,
}: {
  server: Server;
  isStarting: boolean;
  isStopping: boolean;
  isBusy: boolean;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const confirmRemove = () => {
    if (window.confirm(`Remove server "${server.name}"? This cannot be undone.`)) {
      void onRemove(server.id);
    }
  };

  return (
    <div className="flex items-center gap-0.5 shrink-0 bg-surface-300/50 rounded-lg p-0.5">
      <LifecycleButton
        serverId={server.id}
        isRunning={server.status === "running"}
        isStarting={isStarting}
        isStopping={isStopping}
        isBusy={isBusy}
        onStart={onStart}
        onStop={onStop}
      />
      <Button
        variant="ghost"
        size="icon"
        className="text-[rgba(38,37,30,0.45)] hover:text-cursor-dark hover:bg-surface-400 active:bg-surface-500 transition-all duration-150"
        onClick={() => navigate(`/servers/${server.id}`)}
        title="Server details"
      >
        <Settings className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="text-[rgba(38,37,30,0.45)] hover:text-error-warm hover:bg-error-warm/10 active:bg-error-warm/20 transition-all duration-150"
        onClick={confirmRemove}
        title="Remove server"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ServerErrorMessage({ message }: { message: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-error-warm/15 bg-error-warm/8 px-3 py-2">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-error-warm" />
      <p className="truncate font-mono text-[11px] text-error-warm" title={message}>
        {message}
      </p>
    </div>
  );
}

export function ServerCard({ server, action, onStart, onStop, onRemove }: ServerCardProps) {
  const isRunning = server.status === "running";
  const isError = server.status === "error";
  const isStarting = server.status === "starting" || action === "starting";
  const isStopping = action === "stopping";
  const commandPreview = getCommandPreview(server);
  const displayStatus = isStopping ? "stopping" : server.status;

  return (
    <Card
      className={cn(
        "group transition-all duration-200 hover:shadow-[rgba(0,0,0,0.04)_0px_12px_40px,rgba(0,0,0,0.02)_0px_0px_16px]",
        isRunning && !isStopping && "bg-success-muted/[0.02] border-success-muted/10",
        isError && "bg-error-warm/[0.02] border-error-warm/10",
        isStarting && "bg-gold/[0.02] border-gold/10",
        isStopping && "bg-gold/[0.02] border-gold/10",
      )}
    >
      <CardContent className="p-4">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <ServerAvatar isRunning={isRunning} isError={isError} />
              <ServerIdentity
                server={server}
                commandPreview={commandPreview}
                displayStatus={displayStatus}
              />
            </div>
            <ServerControls
              server={server}
              isStarting={isStarting}
              isStopping={isStopping}
              isBusy={isStarting || isStopping}
              onStart={onStart}
              onStop={onStop}
              onRemove={onRemove}
            />
          </div>
          {isError && server.error_message && <ServerErrorMessage message={server.error_message} />}
        </div>
      </CardContent>
    </Card>
  );
}
