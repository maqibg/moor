import { useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import {
  AlertTriangle,
  Loader2,
  PanelRightOpen,
  Play,
  Square,
  Terminal,
  Trash2,
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Server } from "@moor/types";
import type { ServerAction } from "@/hooks/server-patch-utils";
import { cn, getErrorMessage } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";

type RemoveFeedback =
  | { kind: "confirm"; message: string }
  | { kind: "removing"; message: string }
  | { kind: "error"; message: string }
  | null;

function getRemoveFeedback({
  serverName,
  confirmingRemove,
  isRemoving,
  removeError,
  t,
}: {
  serverName: string;
  confirmingRemove: boolean;
  isRemoving: boolean;
  removeError: string | null;
  t: (key: string, vars?: Record<string, string>) => string;
}): RemoveFeedback {
  if (isRemoving)
    return { kind: "removing", message: t("Removing {{serverName}}...", { serverName }) };
  if (removeError) return { kind: "error", message: removeError };
  if (confirmingRemove)
    return {
      kind: "confirm",
      message: t('Remove "{{serverName}}"? This cannot be undone.', { serverName }),
    };
  return null;
}

interface ServerCardProps {
  server: Server;
  action?: ServerAction;
  dragHandle?: ReactNode;
  isSorting?: boolean;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

function getCommandPreview(server: Server): string {
  return server.connectionType === "stdio"
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
            : "bg-surface-300 text-[var(--fg-35)] border border-[var(--fg-08)]",
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
  const { t } = useI18n();
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="font-headline text-sm font-medium text-cursor-dark truncate">
          {server.name}
        </span>
        {server.autoStart && (
          <span title={t("Auto Start")} className="inline-flex shrink-0">
            <Zap className="h-3 w-3 text-gold" />
          </span>
        )}
        <StatusBadge status={displayStatus} />
      </div>
      {commandPreview && (
        <p className="font-mono text-[11px] text-[var(--fg-40)] truncate">{commandPreview}</p>
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
  const { t } = useI18n();
  if (isRunning) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="text-[var(--fg-45)] hover:text-error-warm hover:bg-error-warm/10 active:bg-error-warm/20 transition-all duration-150"
        disabled={isBusy}
        onClick={() => void onStop(serverId)}
        title={isStopping ? t("Stopping server") : t("Stop server")}
      >
        {isStopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-[var(--fg-45)] hover:text-success-muted hover:bg-success-muted/10 active:bg-success-muted/20 transition-all duration-150"
      disabled={isBusy}
      onClick={() => void onStart(serverId)}
      title={isStarting ? t("Starting server") : t("Start server")}
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
  isRemoving,
  onStart,
  onStop,
  onRequestRemove,
}: {
  server: Server;
  isStarting: boolean;
  isStopping: boolean;
  isBusy: boolean;
  isRemoving: boolean;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRequestRemove: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const controlsDisabled = isBusy || isRemoving;

  return (
    <div className="flex items-center gap-1 shrink-0 bg-surface-300/50 rounded-lg p-1">
      <LifecycleButton
        serverId={server.id}
        isRunning={server.status === "running"}
        isStarting={isStarting}
        isStopping={isStopping}
        isBusy={controlsDisabled}
        onStart={onStart}
        onStop={onStop}
      />
      <Button
        variant="ghost"
        size="icon"
        className="text-[var(--fg-45)] hover:text-cursor-dark hover:bg-surface-400 active:bg-surface-500 transition-all duration-150"
        disabled={controlsDisabled}
        onClick={() => navigate(`/servers/${server.id}`)}
        title={t("Server details")}
        aria-label={t("Open details for {{name}}", { name: server.name })}
      >
        <PanelRightOpen className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="text-[var(--fg-45)] hover:text-error-warm hover:bg-error-warm/10 active:bg-error-warm/20 transition-all duration-150"
        disabled={controlsDisabled}
        onClick={onRequestRemove}
        title={t("Remove server")}
        aria-label={t("Remove {{name}}", { name: server.name })}
      >
        {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function RemoveFeedbackRow({
  feedback,
  onCancel,
  onConfirm,
}: {
  feedback: NonNullable<RemoveFeedback>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const isError = feedback.kind === "error";
  const isRemoving = feedback.kind === "removing";

  return (
    <div
      className={cn(
        "mt-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 animate-fade-in",
        isError ? "border-error-warm/15 bg-error-warm/8" : "border-gold/15 bg-gold/8",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {isRemoving ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gold" />
        ) : (
          <AlertTriangle
            className={cn("h-3.5 w-3.5 shrink-0", isError ? "text-error-warm" : "text-gold")}
          />
        )}
        <p
          className={cn(
            "truncate font-body text-xs",
            isError ? "text-error-warm" : "text-[var(--fg-55)]",
          )}
          title={feedback.message}
        >
          {feedback.message}
        </p>
      </div>
      {feedback.kind === "confirm" && (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-error-warm hover:bg-error-warm/10 hover:text-error-warm"
            onClick={onConfirm}
          >
            {t("Remove")}
          </Button>
        </div>
      )}
      {feedback.kind === "error" && (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("Dismiss")}
        </Button>
      )}
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

export function ServerCard({
  server,
  action,
  dragHandle,
  isSorting,
  onStart,
  onStop,
  onRemove,
}: ServerCardProps) {
  const { t } = useI18n();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const isRunning = server.status === "running";
  const isError = server.status === "error";
  const isStarting = server.status === "starting" || action === "starting";
  const isStopping = action === "stopping";
  const commandPreview = getCommandPreview(server);
  const displayStatus = isStopping ? "stopping" : server.status;
  const removeFeedback = getRemoveFeedback({
    serverName: server.name,
    confirmingRemove,
    isRemoving,
    removeError,
    t,
  });

  const handleRemove = async () => {
    setIsRemoving(true);
    setRemoveError(null);
    try {
      await onRemove(server.id);
      setConfirmingRemove(false);
    } catch (err) {
      setRemoveError(getErrorMessage(err, t("Unable to remove server")));
    } finally {
      setIsRemoving(false);
    }
  };

  const clearRemoveFeedback = () => {
    setConfirmingRemove(false);
    setRemoveError(null);
  };

  return (
    <Card
      className={cn(
        "group transition-all duration-200 hover:shadow-[rgba(0,0,0,0.04)_0px_12px_40px,rgba(0,0,0,0.02)_0px_0px_16px]",
        isSorting && "shadow-[rgba(0,0,0,0.08)_0px_18px_44px] ring-1 ring-cursor-orange/20",
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
              {dragHandle}
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
              isRemoving={isRemoving}
              onStart={onStart}
              onStop={onStop}
              onRequestRemove={() => {
                setConfirmingRemove(true);
                setRemoveError(null);
              }}
            />
          </div>
          {removeFeedback && (
            <RemoveFeedbackRow
              feedback={removeFeedback}
              onCancel={clearRemoveFeedback}
              onConfirm={() => void handleRemove()}
            />
          )}
          {isError && server.errorMessage && <ServerErrorMessage message={server.errorMessage} />}
        </div>
      </CardContent>
    </Card>
  );
}
