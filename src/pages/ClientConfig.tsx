import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useApi } from "@/hooks/useApi";
import { getMcpEndpoint } from "@/lib/api";
import { Copy, Check, Terminal, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface ClientSnippet {
  client: string;
  description: string;
  snippet: string;
  cliCommand: string;
}

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      {label && (
        <p className="font-headline text-[11px] text-[rgba(38,37,30,0.5)] mb-1.5 uppercase tracking-wider">
          {label}
        </p>
      )}
      <div className="bg-cursor-dark rounded-xl border border-[rgba(38,37,30,0.15)] p-4 relative overflow-hidden">
        <pre className="font-mono text-[12px] leading-relaxed text-[rgba(242,241,237,0.85)] overflow-x-auto whitespace-pre-wrap pr-10">
          {code}
        </pre>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2.5 right-2.5 h-7 w-7 text-[rgba(242,241,237,0.3)] hover:text-[rgba(242,241,237,0.8)] hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
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
  );
}

export function ClientConfig() {
  const { data: snippets } = useApi<ClientSnippet[]>("/api/import/snippets", []);
  const [mcpEndpoint, setMcpEndpoint] = useState("http://127.0.0.1:9223/mcp");

  useEffect(() => {
    void getMcpEndpoint().then(setMcpEndpoint);
  }, []);

  const displaySnippets =
    !snippets || snippets.length === 0
      ? [
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
            cliCommand:
              '# Edit ~/.config/opencode/opencode.json and add the "mcp.moor" entry above.',
          },
        ]
      : snippets;

  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Header */}
      <div>
        <h1 className="font-headline text-[28px] tracking-tight text-cursor-dark leading-tight">
          Client Configuration
        </h1>
        <p className="font-body text-sm text-[rgba(38,37,30,0.5)] mt-1.5">
          Configure your AI agents to connect to Moor
        </p>
      </div>

      {/* Client Cards */}
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-surface-300 border border-[rgba(38,37,30,0.08)] flex items-center justify-center">
                    <Terminal className="h-4 w-4 text-[rgba(38,37,30,0.5)]" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{s.client}</CardTitle>
                    <p className="font-body text-xs text-[rgba(38,37,30,0.45)] mt-0.5">
                      {s.description}
                    </p>
                  </div>
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

      {/* Tips */}
      <Card className="animate-fade-in-up stagger-3 bg-surface-300/50 border-[rgba(38,37,30,0.06)]">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-cursor-orange/10 flex items-center justify-center shrink-0 mt-0.5">
              <Settings className="h-4 w-4 text-cursor-orange" />
            </div>
            <div>
              <h4 className="font-headline text-sm font-medium text-cursor-dark mb-1">
                Getting Started
              </h4>
              <p className="font-body text-sm text-[rgba(38,37,30,0.5)] leading-relaxed">
                Make sure Moor is running and your MCP client is configured to use the endpoint{" "}
                <code className="font-mono text-xs bg-surface-300 px-1.5 py-0.5 rounded text-[rgba(38,37,30,0.7)]">
                  {mcpEndpoint}
                </code>
                . After configuration, restart your client to pick up the new tools.
              </p>
              <p className="font-body text-sm text-[rgba(38,37,30,0.5)] leading-relaxed mt-2">
                MCP clients do not need an{" "}
                <code className="font-mono text-xs bg-surface-300 px-1.5 py-0.5 rounded text-[rgba(38,37,30,0.7)]">
                  X-Moor-Token
                </code>{" "}
                header. Moor uses that header only for local management APIs, while this endpoint
                stays bound to the loopback interface.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
