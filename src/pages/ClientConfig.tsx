import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { PageHeader } from "@/components/shared/PageHeader";
import { Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConverterPanel } from "@/components/converter/ConverterPanel";

interface ClientSnippet {
  client: string;
  description: string;
  snippet: string;
  cliCommand: string;
}

const FALLBACK_SNIPPETS: ClientSnippet[] = [
  {
    client: "Claude Code",
    description: "Configure Claude Code to connect to Moor",
    snippet:
      '{\n  "mcpServers": {\n    "moor": {\n      "url": "http://127.0.0.1:9223/mcp"\n    }\n  }\n}',
    cliCommand:
      '# Edit ~/.claude/settings.json and add to mcpServers:\n"moor": { "url": "http://127.0.0.1:9223/mcp" }',
  },
  {
    client: "Codex",
    description: "Configure Codex to connect to Moor",
    snippet: '[mcp_servers.moor]\nurl = "http://127.0.0.1:9223/mcp"\nenabled = true',
    cliCommand:
      '# Edit ~/.codex/config.toml and add:\n[mcp_servers.moor]\nurl = "http://127.0.0.1:9223/mcp"\nenabled = true',
  },
  {
    client: "OpenCode",
    description: "Configure OpenCode to connect to Moor",
    snippet:
      '{\n  "$schema": "https://opencode.ai/config.json",\n  "mcp": {\n    "moor": {\n      "type": "remote",\n      "url": "http://127.0.0.1:9223/mcp",\n      "enabled": true\n    }\n  }\n}',
    cliCommand: '# Edit ~/.config/opencode/opencode.json and add the "mcp.moor" entry above.',
  },
  {
    client: "Cursor",
    description: "Configure Cursor to connect to Moor",
    snippet:
      '{\n  "mcpServers": {\n    "moor": {\n      "url": "http://127.0.0.1:9223/mcp"\n    }\n  }\n}',
    cliCommand: "# Edit ~/.cursor/mcp.json and add the mcpServers.moor entry above.",
  },
];

export function ClientConfig() {
  const [activeTab, setActiveTab] = useState("snippets");
  const { data: snippets } = useQuery<ClientSnippet[]>({
    queryKey: ["snippets"],
    queryFn: () => api<ClientSnippet[]>("/api/import/snippets"),
  });

  const displaySnippets = !snippets || snippets.length === 0 ? FALLBACK_SNIPPETS : snippets;

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
            ))}
          </div>
        </>
      )}

      {activeTab === "converter" && <ConverterPanel />}
    </div>
  );
}
