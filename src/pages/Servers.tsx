import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ServerCard } from "@/components/shared/ServerCard";
import { useServers } from "@/hooks/useServers";
import { useSSE } from "@/hooks/useSSE";
import { AlertTriangle, Check, FileJson, Plus, ScanSearch, WandSparkles, X } from "lucide-react";
import { apiPost } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  formatJsonImport,
  getJsonImportDiagnostics,
  type ImportDiagnostic,
} from "@/lib/json-import-editor";

interface ScannedServer {
  name: string;
  connectionType: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  workingDir?: string;
  source: string;
}

interface UnsupportedServer {
  name: string;
  source: string;
  reason: string;
}

interface ImportPreview {
  scanned: number;
  newServers: number;
  servers: ScannedServer[];
  duplicates: ScannedServer[];
  unsupported: UnsupportedServer[];
  errors: string[];
  diagnostics?: ImportDiagnostic[];
}

const JSON_IMPORT_PLACEHOLDER = `{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-server"]
    }
  }
}`;

const JsonImportEditor = lazy(() =>
  import("@/components/shared/JsonImportEditor").then((module) => ({
    default: module.JsonImportEditor,
  })),
);

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
    headers: "",
  });
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [jsonImport, setJsonImport] = useState("");
  const [jsonImportErrors, setJsonImportErrors] = useState<string[]>([]);
  const [jsonImportStatus, setJsonImportStatus] = useState<string | null>(null);
  const [scanCandidates, setScanCandidates] = useState<ScannedServer[]>([]);
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const jsonImportDiagnostics = useMemo(() => getJsonImportDiagnostics(jsonImport), [jsonImport]);

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

    let env: Record<string, string> | undefined;
    let headers: Record<string, string> | undefined;

    if (form.env) {
      try {
        env = JSON.parse(form.env) as Record<string, string>;
      } catch {
        setScanStatus("Invalid JSON in environment variables field");
        return;
      }
    }

    if (form.connectionType === "http" && form.headers) {
      try {
        headers = JSON.parse(form.headers) as Record<string, string>;
      } catch {
        setScanStatus("Invalid JSON in HTTP headers field");
        return;
      }
    }

    await apiPost("/api/servers", {
      name: form.name,
      connectionType: form.connectionType,
      command: form.connectionType === "stdio" ? form.command : undefined,
      args: form.args ? form.args.split(" ") : undefined,
      url: form.connectionType === "http" ? form.url : undefined,
      env,
      headers,
    });
    setShowAdd(false);
    setForm({
      name: "",
      connectionType: "stdio",
      command: "",
      args: "",
      url: "",
      env: "",
      headers: "",
    });
    refresh();
  };

  const applyImportPreview = (result: ImportPreview) => {
    setImportPreview(result);
    setScanCandidates(result.servers);
    setSelectedImports(new Set(result.servers.map((server) => server.name)));
    setScanStatus(
      result.newServers === 0 ? `Scanned ${result.scanned} configs. No new servers found.` : null,
    );
  };

  const handleScan = async () => {
    try {
      const result = await apiPost<ImportPreview>("/api/import/scan", {});
      applyImportPreview(result);
    } catch (err) {
      setScanStatus((err as Error).message);
    }
  };

  const handleJsonImportChange = (value: string) => {
    setJsonImport(value);
    setJsonImportErrors([]);
    setJsonImportStatus(null);
  };

  const handleFormatJsonImport = () => {
    const result = formatJsonImport(jsonImport);
    setJsonImportErrors([]);

    if (result.diagnostics.length > 0) {
      setJsonImportStatus("Fix JSON syntax errors before formatting.");
      return;
    }

    setJsonImport(result.value);
    setJsonImportStatus(result.formatted ? "JSON formatted." : "JSON is already formatted.");
  };

  const handleParseJsonImport = async () => {
    if (jsonImportDiagnostics.length > 0) {
      setJsonImportErrors([]);
      setJsonImportStatus("Fix JSON syntax errors before previewing.");
      return;
    }

    try {
      const result = await apiPost<ImportPreview>("/api/import/parse", { content: jsonImport });
      if (result.errors.length > 0 || (result.diagnostics?.length ?? 0) > 0) {
        setImportPreview(result);
        setScanCandidates([]);
        setSelectedImports(new Set());
        setJsonImportErrors(result.errors);
        setJsonImportStatus(null);
        return;
      }

      applyImportPreview(result);
      setShowJsonImport(false);
      setJsonImportErrors([]);
      setJsonImportStatus(null);
    } catch (err) {
      setJsonImportErrors([(err as Error).message]);
      setJsonImportStatus(null);
    }
  };

  const handleImportSelected = async () => {
    const serversToImport = scanCandidates.filter((server) => selectedImports.has(server.name));
    const result = await apiPost<{ imported: string[]; skipped: string[] }>("/api/import/execute", {
      servers: serversToImport,
    });
    setScanStatus(`Imported ${result.imported.length} servers. Skipped ${result.skipped.length}.`);
    setScanCandidates([]);
    setSelectedImports(new Set());
    setImportPreview(null);
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

  const hasStaticAuthorizationHeader = scanCandidates.some((server) => {
    const authorization = Object.entries(server.headers ?? {}).find(
      ([key]) => key.toLowerCase() === "authorization",
    )?.[1];
    return Boolean(authorization && !authorization.includes("{env:"));
  });
  const jsonImportStatusIsError = jsonImportStatus?.startsWith("Fix ") ?? false;

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
          <Button variant="outline" onClick={() => setShowJsonImport(true)}>
            <FileJson className="h-4 w-4 mr-2" /> Import JSON
          </Button>
          <Button variant="outline" onClick={handleScan}>
            <ScanSearch className="h-4 w-4 mr-2" /> Scan Configs
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Server
          </Button>
        </div>
      </div>

      {/* JSON Import Form */}
      {showJsonImport && (
        <Card className="animate-scale-in border-[rgba(38,37,30,0.08)]">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Import MCP JSON</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setShowJsonImport(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-[rgba(38,37,30,0.5)]" />
                <span className="font-mono text-[11px] text-[rgba(38,37,30,0.48)]">JSONC</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleFormatJsonImport}
                disabled={!jsonImport.trim()}
              >
                <WandSparkles className="h-3.5 w-3.5 mr-2" />
                Format JSON
              </Button>
            </div>
            <Suspense
              fallback={
                <div className="h-[300px] rounded-xl border border-[rgba(38,37,30,0.1)] bg-surface-200/40" />
              }
            >
              <JsonImportEditor
                value={jsonImport}
                placeholder={JSON_IMPORT_PLACEHOLDER}
                diagnostics={jsonImportDiagnostics}
                onChange={handleJsonImportChange}
              />
            </Suspense>
            {jsonImportStatus && (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2",
                  jsonImportStatusIsError
                    ? "border-error-warm/20 bg-error-warm/8"
                    : "border-[rgba(38,37,30,0.08)] bg-surface-300/40",
                )}
              >
                {jsonImportStatusIsError ? (
                  <AlertTriangle className="h-4 w-4 text-error-warm" />
                ) : (
                  <Check className="h-4 w-4 text-success-muted" />
                )}
                <p className="font-body text-xs text-[rgba(38,37,30,0.55)]">{jsonImportStatus}</p>
              </div>
            )}
            {jsonImportErrors.length > 0 && (
              <div className="rounded-lg border border-error-warm/20 bg-error-warm/8 px-3 py-2">
                {jsonImportErrors.map((error) => (
                  <p key={error} className="font-body text-xs text-error-warm">
                    {error}
                  </p>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowJsonImport(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleParseJsonImport}
                disabled={!jsonImport.trim() || jsonImportDiagnostics.length > 0}
              >
                Preview Import
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
              <>
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
                <div>
                  <label className="font-headline text-xs text-[rgba(38,37,30,0.5)] mb-1.5 block">
                    HTTP Headers (JSON, optional)
                  </label>
                  <Input
                    placeholder='{"Authorization":"Bearer {env:MCP_TOKEN}"}'
                    value={form.headers}
                    onChange={(e) => setForm((f) => ({ ...f, headers: e.target.value }))}
                  />
                </div>
              </>
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
                  setImportPreview(null);
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
            {hasStaticAuthorizationHeader && (
              <div className="flex items-start gap-2 rounded-lg border border-gold/20 bg-gold/8 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-gold shrink-0 mt-0.5" />
                <p className="font-body text-xs leading-relaxed text-[rgba(38,37,30,0.55)]">
                  Static Authorization headers are stored in Moor's local SQLite database. Prefer{" "}
                  <code className="font-mono">{"{env:VAR_NAME}"}</code> when possible.
                </p>
              </div>
            )}
            {importPreview && importPreview.errors.length > 0 && (
              <div className="rounded-lg border border-error-warm/20 bg-error-warm/8 px-3 py-2">
                {importPreview.errors.map((error) => (
                  <p key={error} className="font-body text-xs text-error-warm">
                    {error}
                  </p>
                ))}
              </div>
            )}
            {importPreview && importPreview.unsupported.length > 0 && (
              <div className="rounded-lg border border-[rgba(38,37,30,0.08)] bg-surface-300/40 px-3 py-2">
                <p className="font-headline text-xs text-[rgba(38,37,30,0.55)] mb-1.5">
                  Unsupported ({importPreview.unsupported.length})
                </p>
                <div className="space-y-1">
                  {importPreview.unsupported.map((server) => (
                    <p
                      key={`${server.source}:${server.name}:${server.reason}`}
                      className="font-body text-xs text-[rgba(38,37,30,0.48)]"
                    >
                      <span className="font-mono text-[rgba(38,37,30,0.62)]">{server.name}</span>:{" "}
                      {server.reason}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {importPreview && importPreview.duplicates.length > 0 && (
              <div className="rounded-lg border border-[rgba(38,37,30,0.08)] bg-surface-300/30 px-3 py-2">
                <p className="font-body text-xs text-[rgba(38,37,30,0.48)]">
                  Skipping {importPreview.duplicates.length} duplicate server
                  {importPreview.duplicates.length > 1 ? "s" : ""} by name.
                </p>
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
