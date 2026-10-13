import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/api-routes";
import { ConverterPanel } from "@/components/converter/ConverterPanel";
import type { ClientSnippet } from "@moor/types";
import { useI18n } from "@/hooks/useI18n";

export function ClientConfig() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState("snippets");
  const { data: snippets, error: snippetsError } = useQuery<ClientSnippet[]>({
    queryKey: ["snippets"],
    queryFn: () => api<ClientSnippet[]>(routes.import.snippets()),
  });

  const displaySnippets = snippets ?? [];

  return (
    <div className="space-y-6 animate-fade-in-up">
      <PageHeader
        title={t("Client Configuration")}
        subtitle={t("Configure your AI agents to connect to Moor")}
      />

      {snippetsError && <ErrorBanner message={t("Failed to load client snippets")} />}

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        tabs={[
          { value: "snippets", label: t("Snippets") },
          { value: "converter", label: t("Converter") },
        ]}
      />

      {activeTab === "snippets" && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {displaySnippets.map((s, index) => (
              <Card
                key={s.client}
                className={cn(
                  "animate-fade-in-up transition-shadow-smooth hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.06)]",
                  `stagger-${index + 1}`,
                )}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-surface-300 border border-[var(--fg-08)] flex items-center justify-center">
                      <Terminal className="h-4 w-4 text-[var(--fg-50)]" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{s.client}</CardTitle>
                      <p className="font-body text-xs text-[var(--fg-45)] mt-0.5">
                        {t(s.description)}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CodeBlock code={s.snippet} label={t("Configuration")} />
                  {s.cliCommand && <CodeBlock code={s.cliCommand} label={t("CLI Command")} />}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {activeTab === "converter" && <ConverterPanel />}
    </div>
  );
}
