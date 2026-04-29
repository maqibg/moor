import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ServerCard } from "@/components/shared/ServerCard";
import { useServers } from "@/hooks/useServers";
import { useSSE } from "@/hooks/useSSE";
import { Plus, ScanSearch, X, Check } from "lucide-react";
import { apiPost } from "@/lib/api";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

interface ScannedServer {
  name: string;
  connectionType: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  source: string;
}

export function Servers() {
  const { servers, loading, startServer, stopServer, removeServer, refresh } = useServers();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: "",
    connectionType: "stdio" as "stdio" | "http",
    command: "",
    args: "",
    url: "",
    env: "",
  });
  const [scanCandidates, setScanCandidates] = useState<ScannedServer[]>([]);
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const [scanStatus, setScanStatus] = useState<string | null>(null);

  useSSE(
    useCallback(
      (event) => {
        if (event.type === "server:status" || event.type === "server:tools") refresh();
      },
      [refresh],
    ),
  );

  const handleAdd = async () => {
    if (!form.name) return;
    await apiPost("/api/servers", {
      name: form.name,
      connectionType: form.connectionType,
      command: form.connectionType === "stdio" ? form.command : undefined,
      args: form.args ? form.args.split(" ") : undefined,
      url: form.connectionType === "http" ? form.url : undefined,
      env: form.env ? JSON.parse(form.env) : undefined,
    });
    setShowAdd(false);
    setForm({ name: "", connectionType: "stdio", command: "", args: "", url: "", env: "" });
    refresh();
  };

  const handleScan = async () => {
    const result = await apiPost<{
      scanned: number;
      newServers: number;
      servers: ScannedServer[];
    }>("/api/import/scan", {});
    setScanCandidates(result.servers);
    setSelectedImports(new Set(result.servers.map((server) => server.name)));
    setScanStatus(
      result.newServers === 0 ? `Scanned ${result.scanned} configs. No new servers found.` : null,
    );
  };

  const handleImportSelected = async () => {
    const serversToImport = scanCandidates.filter((server) => selectedImports.has(server.name));
    const result = await apiPost<{ imported: string[]; skipped: string[] }>("/api/import/execute", {
      servers: serversToImport,
    });
    setScanStatus(`Imported ${result.imported.length} servers. Skipped ${result.skipped.length}.`);
    setScanCandidates([]);
    setSelectedImports(new Set());
    refresh();
  };

  const toggleImport = (name: string, checked: boolean) => {
    setSelectedImports((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-headline text-[28px] tracking-tight text-cursor-dark leading-tight">
            Servers
          </h1>
          <p className="font-body text-sm text-[rgba(38,37,30,0.5)] mt-1.5">
            Manage and configure your MCP servers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleScan}>
            <ScanSearch className="h-4 w-4 mr-2" /> Scan Configs
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Server
          </Button>
        </div>
      </div>

      {/* Add Server Form */}
      {showAdd && (
        <Card className="animate-scale-in border-cursor-orange/20 shadow-[0_8px_30px_rgba(245,78,0,0.04)]">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Add New Server</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setShowAdd(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-1.5 block">
                  Name
                </label>
                <Input
                  placeholder="e.g., github"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-1.5 block">
                  Type
                </label>
                <select
                  className="flex h-10 w-full rounded-xl border border-[rgba(38,37,30,0.1)] bg-transparent px-3 py-2 font-body text-sm text-cursor-dark focus:border-[rgba(38,37,30,0.2)] focus:outline-none"
                  value={form.connectionType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, connectionType: e.target.value as "stdio" | "http" }))
                  }
                >
                  <option value="stdio">stdio</option>
                  <option value="http">HTTP/SSE</option>
                </select>
              </div>
            </div>
            {form.connectionType === "stdio" ? (
              <>
                <div>
                  <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-1.5 block">
                    Command
                  </label>
                  <Input
                    placeholder="e.g., npx -y @modelcontextprotocol/server-github"
                    value={form.command}
                    onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-1.5 block">
                    Arguments (space-separated)
                  </label>
                  <Input
                    placeholder="e.g., --port 3000"
                    value={form.args}
                    onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-1.5 block">
                  URL
                </label>
                <Input
                  placeholder="e.g., http://localhost:3000/mcp"
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                />
              </div>
            )}
            <div>
              <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-1.5 block">
                Environment Variables (JSON, optional)
              </label>
              <Input
                placeholder='{"API_KEY": "..."}'
                value={form.env}
                onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd}>Add Server</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Config Import */}
      {(scanCandidates.length > 0 || scanStatus) && (
        <Card className="animate-scale-in">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Config Import</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setScanCandidates([]);
                  setScanStatus(null);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {scanStatus && (
              <div className="flex items-center gap-2 py-2">
                <Check className="h-4 w-4 text-success-muted" />
                <p className="font-body text-sm text-[rgba(38,37,30,0.55)]">{scanStatus}</p>
              </div>
            )}
            {scanCandidates.map((server) => (
              <label
                key={`${server.source}:${server.name}`}
                className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-surface-300/50 transition-colors cursor-pointer border border-transparent hover:border-[rgba(38,37,30,0.06)]"
              >
                <div className="min-w-0">
                  <p className="font-headline text-sm text-cursor-dark">{server.name}</p>
                  <p className="font-mono text-[11px] text-[rgba(38,37,30,0.45)] truncate">
                    {server.connectionType === "stdio"
                      ? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")
                      : server.url}
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-[rgba(38,37,30,0.2)] text-cursor-orange focus:ring-cursor-orange/30"
                  checked={selectedImports.has(server.name)}
                  onChange={(event) => toggleImport(server.name, event.currentTarget.checked)}
                />
              </label>
            ))}
            {scanCandidates.length > 0 && (
              <div className="flex justify-end pt-1">
                <Button onClick={handleImportSelected} disabled={selectedImports.size === 0}>
                  Import Selected ({selectedImports.size})
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Server List */}
      <div className="space-y-2">
        {loading ? (
          <div className="py-16 text-center">
            <div className="h-8 w-8 mx-auto rounded-full border-2 border-[rgba(38,37,30,0.1)] border-t-cursor-orange animate-spin mb-4" />
            <p className="font-body text-sm text-[rgba(38,37,30,0.4)]">Loading servers...</p>
          </div>
        ) : servers.length === 0 ? (
          <button
            onClick={() => setShowAdd(true)}
            className={cn(
              "w-full py-10 rounded-xl border-2 border-dashed border-[rgba(38,37,30,0.12)]",
              "text-[rgba(38,37,30,0.4)] hover:text-cursor-orange hover:border-cursor-orange/30 hover:bg-cursor-orange/[0.02]",
              "transition-all duration-200 flex flex-col items-center justify-center gap-3 cursor-pointer",
            )}
          >
            <div className="h-12 w-12 rounded-full bg-surface-300 flex items-center justify-center">
              <Plus className="h-5 w-5" />
            </div>
            <div className="text-center">
              <p className="font-headline text-sm font-medium">Add Your First Server</p>
              <p className="font-body text-xs text-[rgba(38,37,30,0.4)] mt-1">
                Or scan existing configs to import
              </p>
            </div>
          </button>
        ) : (
          servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              onStart={startServer}
              onStop={stopServer}
              onRemove={removeServer}
            />
          ))
        )}
      </div>
    </div>
  );
}
