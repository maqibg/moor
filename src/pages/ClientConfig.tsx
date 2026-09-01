import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Bot,
  Braces,
  Command,
  MessageSquare,
  Moon,
  MousePointer2,
  Orbit,
  SquareTerminal,
  Terminal,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/api-routes";
import { ConverterPanel } from "@/components/converter/ConverterPanel";
import { importKeys } from "@/lib/query-keys";
import type { ClientSnippet } from "@moor/types";

// Per-client glyphs keyed by registry id; Terminal is the fallback.
// 与 Rust 侧 ALL_CLIENTS 对齐，覆盖性由 ClientConfig.test.tsx 护栏约束。
export const CLIENT_ICONS: Record<string, LucideIcon> = {
  "claude-code": SquareTerminal,
  "claude-desktop": MessageSquare,
  codex: Orbit,
  cursor: MousePointer2,
  opencode: Braces,
  "kimi-code": Moon,
  dsh: Bot,
  "grok-build": Zap,
  pi: Command,
};
export function ClientConfig() {
  const [activeTab, setActiveTab] = useState("snippets");
  const { data: snippets } = useQuery<ClientSnippet[]>({
    queryKey: importKeys.snippets(),
    queryFn: () => api<ClientSnippet[]>(routes.import.snippets()),
  });

  const displaySnippets = snippets ?? [];

  return (
    <div className="space-y-6 animate-fade-in-up">
      <PageHeader
        title="Client Configuration"
        subtitle="Configure your AI agents to connect to Moor"
      />

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        tabs={[
          { value: "snippets", label: "Snippets" },
          { value: "converter", label: "Converter" },
        ]}
      />

      {activeTab === "snippets" && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {displaySnippets.map((s, index) => {
              const ClientIcon = CLIENT_ICONS[s.clientId] ?? Terminal;
              return (
                <Card
                  key={s.clientId}
                  className={cn(
                    "animate-fade-in-up transition-shadow-smooth hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.06)]",
                    `stagger-${index + 1}`,
                  )}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-surface-300 border border-[var(--fg-08)] flex items-center justify-center">
                        <ClientIcon className="h-4 w-4 text-[var(--fg-50)]" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{s.client}</CardTitle>
                        <p className="font-body text-xs text-[var(--fg-45)] mt-0.5">
                          {s.description}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <CodeBlock code={s.snippet} label="Configuration" />
                    {s.cliCommand && <CodeBlock code={s.cliCommand} label="CLI Command" />}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {activeTab === "converter" && <ConverterPanel />}
    </div>
  );
}
