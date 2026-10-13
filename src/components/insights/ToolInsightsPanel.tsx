import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { AlertTriangle, BarChart3 } from "lucide-react";
import { useLogInsights } from "@/hooks/useLogs";
import { useI18n } from "@/hooks/useI18n";
import {
  type InsightsWindow,
  formatMs,
  formatRate,
  isToolErrorProne,
  isToolSlow,
} from "@/lib/insights";

const WINDOWS: InsightsWindow[] = ["24h", "7d", "30d", "all"];

/** Windowed tool-call insights, the governance view over the audit log. */
export function ToolInsightsPanel() {
  const { t } = useI18n();
  const [window, setWindow] = useState<InsightsWindow>("7d");
  const { insights, loading, error } = useLogInsights(window);

  return (
    <Card className="animate-fade-in-up stagger-5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[var(--fg-40)]" /> {t("Tool Insights")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs
          value={window}
          onValueChange={(value) => setWindow(value as InsightsWindow)}
          tabs={WINDOWS.map((value) => ({ value, label: t(value) }))}
        />

        {error && (
          <p className="font-body text-xs text-error-warm">{t("Failed to load tool insights")}</p>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-1 font-body text-xs text-[var(--fg-60)]">
          <span>
            {t("Calls")}: <strong className="text-cursor-dark">{insights.totalCalls}</strong>
          </span>
          <span>
            {t("Error Rate")}:{" "}
            <strong className="text-cursor-dark">{formatRate(insights.errorRate)}</strong>
          </span>
          <span>
            {t("Avg Duration")}:{" "}
            <strong className="text-cursor-dark">{formatMs(insights.avgDurationMs)}</strong>
          </span>
        </div>

        {insights.tools.length === 0 ? (
          <p className="font-body text-xs text-[var(--fg-40)]">
            {loading ? t("Loading...") : t("No tool calls in this window")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full font-body text-xs">
              <thead>
                <tr className="border-b border-[var(--fg-08)] text-left text-[11px] uppercase tracking-wider text-[var(--fg-45)]">
                  <th className="py-2 pr-3 font-medium">{t("Tool")}</th>
                  <th className="py-2 pr-3 font-medium">{t("Server")}</th>
                  <th className="py-2 pr-3 font-medium">{t("Calls")}</th>
                  <th className="py-2 pr-3 font-medium">{t("Error Rate")}</th>
                  <th className="py-2 pr-3 font-medium">p50</th>
                  <th className="py-2 pr-3 font-medium">p95</th>
                  <th className="py-2 font-medium">{t("Flags")}</th>
                </tr>
              </thead>
              <tbody>
                {insights.tools.map((tool) => (
                  <tr
                    key={`${tool.serverId ?? "none"}:${tool.toolName}`}
                    className="border-b border-[var(--fg-06)] last:border-0"
                  >
                    <td className="py-2 pr-3 font-headline text-cursor-dark">{tool.toolName}</td>
                    <td className="py-2 pr-3 text-[var(--fg-55)]">
                      {tool.serverName ?? tool.serverId ?? "—"}
                    </td>
                    <td className="py-2 pr-3">{tool.callCount}</td>
                    <td className="py-2 pr-3">{formatRate(tool.errorRate)}</td>
                    <td className="py-2 pr-3">{formatMs(tool.p50Ms)}</td>
                    <td className="py-2 pr-3">{formatMs(tool.p95Ms)}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {isToolErrorProne(tool) && (
                          <Badge
                            variant="subtle"
                            className="text-[10px] text-error-warm border-error-warm/20 bg-error-warm/10"
                          >
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {t("Error-prone")}
                          </Badge>
                        )}
                        {isToolSlow(tool) && (
                          <Badge variant="subtle" className="text-[10px]">
                            {t("Slow")}
                          </Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
