import type { ServerHealth as HealthSnapshot, ServerHealthStatus } from "@moor/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { useI18n } from "@/hooks/useI18n";
import { useHealthCheck, useServerHealth } from "@/hooks/useServerHealth";
import {
  formatHealthFailureSummary,
  healthBadgeVariant,
  healthStatusLabel,
  isHealthFailure,
} from "@/lib/server-health";
import { Activity, Loader2 } from "lucide-react";

export function HealthBadge({
  snapshot,
  className,
}: {
  snapshot?: HealthSnapshot;
  className?: string;
}) {
  const { t } = useI18n();
  const status: ServerHealthStatus = snapshot?.status ?? "unknown";
  const failed = snapshot !== undefined && isHealthFailure(snapshot.status);

  return (
    <Badge
      variant={healthBadgeVariant(status)}
      className={className}
      title={failed && snapshot ? formatHealthFailureSummary(snapshot, t) : undefined}
    >
      {t(healthStatusLabel(status))}
      {failed && snapshot && snapshot.consecutiveFailures > 0 && (
        <span className="ml-1 font-mono">({snapshot.consecutiveFailures})</span>
      )}
    </Badge>
  );
}

/** 详情页健康面板：四态徽章、手动探测、失败次数与脱敏错误摘要。 */
export function ServerHealthPanel({ serverId, running }: { serverId: string; running: boolean }) {
  const { t } = useI18n();
  const { snapshots } = useServerHealth();
  const { check, pending, errorKey, clearError } = useHealthCheck(serverId);

  const snapshot = snapshots.find((item) => item.serverId === serverId);
  const visible = running ? snapshot : undefined;
  const failed = visible !== undefined && isHealthFailure(visible.status);

  return (
    <div className="rounded-xl border border-[var(--fg-08)] bg-surface-100 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-headline text-sm text-cursor-dark">{t("Server Health")}</span>
          <HealthBadge snapshot={visible} />
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!running || pending}
          onClick={check}
          title={t("Check now")}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Activity className="h-3.5 w-3.5 mr-1.5" />
          )}
          {t(pending ? "Checking..." : "Check now")}
        </Button>
      </div>

      <p className="font-body text-xs text-[var(--fg-45)]">
        {t("Health checks only report problems. Stop and start the server manually to recover.")}
      </p>

      {visible?.checkedAt && (
        <p className="font-body text-xs text-[var(--fg-45)]">
          {t("Last checked: {{time}}; consecutive failures: {{count}}", {
            time: new Date(visible.checkedAt).toLocaleString(),
            count: String(visible.consecutiveFailures),
          })}
        </p>
      )}

      {failed && visible && (
        <ErrorBanner message={formatHealthFailureSummary(visible, t)} variant="mono" />
      )}

      {errorKey && (
        <div className="flex items-center gap-2">
          <ErrorBanner message={t(errorKey)} className="min-w-0 flex-1" />
          <Button variant="ghost" size="sm" onClick={clearError}>
            {t("Dismiss")}
          </Button>
        </div>
      )}
    </div>
  );
}
