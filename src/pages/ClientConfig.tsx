import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/shared/CopyButton";
import { useApi } from "@/hooks/useApi";

interface ClientSnippet {
  client: string;
  description: string;
  snippet: string;
  cliCommand: string;
}

export function ClientConfig() {
  const { data: snippets } = useApi<ClientSnippet[]>("/api/import/snippets", []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline text-2xl tracking-tight text-cursor-dark">Client Configuration</h1>
        <p className="font-body text-sm text-[rgba(38,37,30,0.55)] mt-1">
          Configure your AI agents to connect to Moor
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {(!snippets || snippets.length === 0 ? [
          { client: "Claude Code", description: "Loading...", snippet: "{}", cliCommand: "" },
        ] : snippets).map((s) => (
          <Card key={s.client}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{s.client}</CardTitle>
                <CopyButton text={s.snippet} />
              </div>
              <p className="font-body text-xs text-[rgba(38,37,30,0.55)]">{s.description}</p>
            </CardHeader>
            <CardContent>
              <pre className="font-mono text-xs bg-surface-300 rounded-lg p-3 text-[rgba(38,37,30,0.7)] overflow-x-auto whitespace-pre-wrap">
                {s.snippet}
              </pre>
              {s.cliCommand && (
                <div className="mt-3 flex items-start gap-2">
                  <pre className="font-mono text-xs text-[rgba(38,37,30,0.55)] flex-1 whitespace-pre-wrap">
                    {s.cliCommand}
                  </pre>
                  <CopyButton text={s.cliCommand} />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
