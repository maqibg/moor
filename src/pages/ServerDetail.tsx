import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageLoading } from "@/components/shared/PageLoading";
import { EmptyState } from "@/components/shared/EmptyState";
import { KeyValueTable } from "@/components/shared/KeyValueTable";
import { KeyValueEditor } from "@/components/shared/KeyValueEditor";
import { CopyButton } from "@/components/shared/CopyButton";
import { useParams, useNavigate, useBlocker } from "react-router-dom";
import { ArrowLeft, Play, Square, RefreshCw, Terminal, Pencil, X, Check } from "lucide-react";
import { useProfiles } from "@/hooks/useProfiles";
import { useServerActions, useServer, useServerTools } from "@/hooks/useServers";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ConnectionType, ServerDetail } from "@moor/types";

interface EditForm {
  name: string;
  command: string;
  url: string;
  args: string;
  env: Array<[string, string]>;
  headers: Array<[string, string]>;
  workingDir: string;
}

function serverToForm(server: ServerDetail): EditForm {
  return {
    name: server.name ?? "",
    command: server.command ?? "",
    url: server.url ?? "",
    args: server.args?.join("\n") ?? "",
    env: server.env ? Object.entries(server.env) : [],
    headers: server.headers ? Object.entries(server.headers) : [],
    workingDir: server.workingDir ?? "",
  };
}

function entriesToRecord(entries: Array<[string, string]>): Record<string, string> | null {
  const record: Record<string, string> = {};
  for (const [key, value] of entries) {
    const trimmedKey = key.trim();
    if (trimmedKey) {
      record[trimmedKey] = value;
    }
  }
  return Object.keys(record).length > 0 ? record : null;
}

function argsToArray(args: string): string[] | null {
  const parsed = args
    .split("\n")
    .map((arg) => arg.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : null;
}

function validateEditForm(form: EditForm, connectionType: ConnectionType): string | null {
  if (!form.name.trim()) return "Name is required.";
  if (connectionType === "stdio" && !form.command.trim()) return "Command is required.";
  if (connectionType === "http" && !form.url.trim()) return "URL is required.";
  return null;
}

function formToUpdates(form: EditForm, connectionType: ConnectionType): Record<string, unknown> {
  const updates: Record<string, unknown> = { name: form.name.trim() };
  const env = entriesToRecord(form.env);

  if (connectionType === "stdio") {
    updates.command = form.command.trim();
    updates.args = argsToArray(form.args);
    updates.env = env;
    updates.workingDir = form.workingDir.trim() || null;
    return updates;
  }

  updates.url = form.url.trim();
  updates.headers = entriesToRecord(form.headers);
  updates.env = env;
  return updates;
}

function hasChanges(form: EditForm, server: ServerDetail): boolean {
  return JSON.stringify(form) !== JSON.stringify(serverToForm(server));
}

export function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { startServer, stopServer, updateServer } = useServerActions();
  const { profiles, updateProfileServer } = useProfiles();
  const activeProfile = profiles.find((profile) => profile.isActive);

  const { server, isLoading: loading } = useServer(id);
  const { tools, refresh: refreshTools } = useServerTools(id, activeProfile?.id);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = isEditing && server && editForm ? hasChanges(editForm, server) : false;

  const blocker = useBlocker(dirty);

  const enterEdit = useCallback(() => {
    if (!server) return;
    setEditForm(serverToForm(server));
    setIsEditing(true);
  }, [server]);

  const cancelEdit = useCallback(() => {
    setEditForm(null);
    setIsEditing(false);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!id || !editForm || !server) return;
    const validationError = validateEditForm(editForm, server.connectionType);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const updates = formToUpdates(editForm, server.connectionType);
      await updateServer({ id, updates });
      if (server?.status === "running") {
        toast.success("Configuration saved", {
          description: "Restart the server to apply changes.",
        });
      } else {
        toast.success("Configuration saved");
      }
      setIsEditing(false);
      setEditForm(null);
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }, [id, editForm, updateServer, server]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  if (loading || !server?.id) {
    return <PageLoading message="Loading server details..." />;
  }

  const handleDiscoverTools = async () => {
    if (server.status === "running") {
      await stopServer(id!);
      await startServer(id!);
    } else {
      await startServer(id!);
    }
  };

  const toggleTool = async (toolName: string, enabled: boolean) => {
    if (!activeProfile || !id) return;
    const disabledTools = new Set(
      tools.filter((tool) => tool.disabled).map((tool) => tool.toolName),
    );
    if (enabled) {
      disabledTools.delete(toolName);
    } else {
      disabledTools.add(toolName);
    }
    await updateProfileServer({
      profileId: activeProfile.id,
      serverId: id,
      updates: { disabledTools: Array.from(disabledTools) },
    });
    refreshTools();
  };

  const toggleAutoStart = async (value: boolean) => {
    if (!id) return;
    try {
      await updateServer({ id, updates: { autoStart: value } });
    } catch {
      // 请求失败时 SSE 会还原 Switch 状态
    }
  };

  const commandText =
    server.connectionType === "stdio"
      ? `${server.command || ""} ${server.args?.join(" ") || ""}`.trim()
      : server.url || "";

  const envEntries = server.env ? Object.entries(server.env) : [];
  const headerEntries = server.headers ? Object.entries(server.headers) : [];

  return (
    <div className="space-y-6 animate-fade-in-up">
      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. They will be lost if you leave this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" className="mt-0.5" onClick={() => navigate("/servers")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div
              className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center border shrink-0",
                server.status === "running"
                  ? "bg-success-muted/10 text-success-muted border-success-muted/20"
                  : server.status === "error"
                    ? "bg-error-warm/10 text-error-warm border-error-warm/20"
                    : "bg-surface-300 text-[var(--fg-35)] border-[var(--fg-08)]",
              )}
            >
              <Terminal className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="font-headline text-[22px] tracking-tight text-cursor-dark">
                  {server.name}
                </h1>
                <StatusBadge status={server.status} />
              </div>
              <p className="font-mono text-[11px] text-[var(--fg-40)] mt-0.5 truncate">
                {commandText || "No command configured"}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={cancelEdit}>
                <X className="h-4 w-4 mr-2" /> Cancel
              </Button>
              <Button onClick={saveEdit} disabled={!dirty || saving}>
                <Check className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={enterEdit}>
                <Pencil className="h-4 w-4 mr-2" /> Edit
              </Button>
              {server.status === "running" ? (
                <Button variant="outline" onClick={() => stopServer(id!)}>
                  <Square className="h-4 w-4 mr-2" /> Stop
                </Button>
              ) : (
                <Button onClick={() => startServer(id!)}>
                  <Play className="h-4 w-4 mr-2" /> Start
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isEditing && editForm ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => f && { ...f, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Connection Type</Label>
                  <Input
                    value={server.connectionType}
                    readOnly
                    className="capitalize bg-surface-300/50"
                  />
                </div>
              </div>
              {server.connectionType === "stdio" ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Command</Label>
                    <Input
                      placeholder="e.g., npx -y @modelcontextprotocol/server-github"
                      value={editForm.command}
                      onChange={(e) => setEditForm((f) => f && { ...f, command: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Arguments (one per line)</Label>
                    <Textarea
                      placeholder={"-y\n@modelcontextprotocol/server-github"}
                      value={editForm.args}
                      onChange={(e) => setEditForm((f) => f && { ...f, args: e.target.value })}
                      className="min-h-[80px] font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Working Directory</Label>
                    <Input
                      placeholder="e.g., /path/to/project"
                      value={editForm.workingDir}
                      onChange={(e) =>
                        setEditForm((f) => f && { ...f, workingDir: e.target.value })
                      }
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>URL</Label>
                    <Input
                      placeholder="e.g., http://localhost:3000/mcp"
                      value={editForm.url}
                      onChange={(e) => setEditForm((f) => f && { ...f, url: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>HTTP Headers</Label>
                    <KeyValueEditor
                      entries={editForm.headers}
                      onChange={(headers) => setEditForm((f) => f && { ...f, headers })}
                      keyLabel="Header"
                      keyPlaceholder="Authorization"
                      valuePlaceholder="Bearer {env:MCP_TOKEN}"
                    />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label>Environment Variables</Label>
                <KeyValueEditor
                  entries={editForm.env}
                  onChange={(env) => setEditForm((f) => f && { ...f, env })}
                  keyPlaceholder="API_KEY"
                  valuePlaceholder="your-api-key"
                />
              </div>
            </>
          ) : (
            <>
              {commandText && (
                <div>
                  <label className="font-headline text-xs text-[var(--fg-50)] mb-2 block uppercase tracking-wider">
                    {server.connectionType === "stdio" ? "Command" : "URL"}
                  </label>
                  <div className="bg-surface-inverted rounded-xl border border-[var(--fg-15)] p-4 relative group">
                    <pre className="font-mono text-xs text-text-inverted overflow-x-auto whitespace-pre-wrap pr-10">
                      {commandText}
                    </pre>
                    <CopyButton
                      text={commandText}
                      className="absolute top-2.5 right-2.5 text-[rgba(242,241,237,0.4)] hover:text-[rgba(242,241,237,0.8)] hover:bg-white/10"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-headline text-xs text-[var(--fg-50)] mb-1.5 block">
                    Connection Type
                  </label>
                  <Badge variant="outline" className="capitalize">
                    {server.connectionType}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <label className="font-headline text-xs text-[var(--fg-50)] mb-1.5 block">
                      Auto Start
                    </label>
                    <p className="text-[11px] text-[var(--fg-40)]">
                      Start automatically when Moor launches
                    </p>
                  </div>
                  <Switch
                    checked={server.autoStart}
                    onCheckedChange={(v) => void toggleAutoStart(v)}
                  />
                </div>
                {server.workingDir && (
                  <div className="col-span-2">
                    <label className="font-headline text-xs text-[var(--fg-50)] mb-1.5 block">
                      Working Directory
                    </label>
                    <p className="font-mono text-xs text-[var(--fg-55)] bg-surface-300 rounded-lg px-3 py-2">
                      {server.workingDir}
                    </p>
                  </div>
                )}
              </div>

              {envEntries.length > 0 && (
                <div>
                  <label className="font-headline text-xs text-[var(--fg-50)] mb-2 block">
                    Environment Variables
                  </label>
                  <KeyValueTable entries={envEntries} />
                </div>
              )}

              {headerEntries.length > 0 && (
                <div>
                  <label className="font-headline text-xs text-[var(--fg-50)] mb-2 block">
                    HTTP Headers
                  </label>
                  <KeyValueTable entries={headerEntries} keyLabel="Header" />
                </div>
              )}
            </>
          )}

          {server.errorMessage && (
            <div className="rounded-xl bg-error-warm/8 border border-error-warm/20 p-4">
              <label className="font-headline text-xs text-error-warm mb-1.5 block">Error</label>
              <p className="font-mono text-xs text-error-warm">{server.errorMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tools */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Discovered Tools</CardTitle>
              <Badge variant="subtle">{tools.length}</Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={handleDiscoverTools}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {tools.length === 0 ? (
            <EmptyState
              icon={Terminal}
              message="No tools discovered. Start the server to discover tools."
            />
          ) : (
            <div className="space-y-2">
              {tools.map((tool) => (
                <div
                  key={tool.toolName}
                  className={cn(
                    "flex items-center justify-between p-4 rounded-xl border transition-all duration-200",
                    tool.disabled
                      ? "bg-surface-300/40 border-[var(--fg-06)] opacity-60"
                      : "bg-surface-100 border-[var(--fg-08)] hover:border-[var(--fg-15)]",
                  )}
                >
                  <div className="min-w-0 flex-1 mr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[13px] font-medium text-cursor-dark">
                        {tool.exposedName}
                      </span>
                      <ToolCategoryBadge name={tool.toolName} />
                    </div>
                    {tool.description && (
                      <p className="font-body text-xs text-[var(--fg-50)] truncate">
                        {tool.description}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={!tool.disabled}
                    disabled={!activeProfile}
                    onCheckedChange={(v) => toggleTool(tool.toolName, v)}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ToolCategoryBadge({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("read") || lower.includes("get") || lower.includes("fetch")) {
    return (
      <Badge variant="subtle" className="text-[10px] bg-read/15 text-read border-read/20">
        Read
      </Badge>
    );
  }
  if (
    lower.includes("write") ||
    lower.includes("edit") ||
    lower.includes("update") ||
    lower.includes("create")
  ) {
    return (
      <Badge variant="subtle" className="text-[10px] bg-edit/15 text-edit border-edit/20">
        Edit
      </Badge>
    );
  }
  if (
    lower.includes("search") ||
    lower.includes("find") ||
    lower.includes("list") ||
    lower.includes("grep")
  ) {
    return (
      <Badge variant="subtle" className="text-[10px] bg-grep/15 text-grep border-grep/20">
        Search
      </Badge>
    );
  }
  if (lower.includes("delete") || lower.includes("remove") || lower.includes("destroy")) {
    return (
      <Badge
        variant="subtle"
        className="text-[10px] bg-error-warm/10 text-error-warm border-error-warm/15"
      >
        Destructive
      </Badge>
    );
  }
  return (
    <Badge variant="subtle" className="text-[10px]">
      Tool
    </Badge>
  );
}
