import { useState, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageLoading } from "@/components/shared/PageLoading";
import { EmptyState } from "@/components/shared/EmptyState";
import { KeyValueTable } from "@/components/shared/KeyValueTable";
import { KeyValueEditor } from "@/components/shared/KeyValueEditor";
import { CopyButton } from "@/components/shared/CopyButton";
import { UnsavedChangesDialog } from "@/components/shared/UnsavedChangesDialog";
import { useParams, useNavigate, useBlocker } from "react-router-dom";
import { ArrowLeft, Play, Square, RefreshCw, Terminal, Pencil, X, Check } from "lucide-react";
import { useProfiles } from "@/hooks/useProfiles";
import { useServerActions, useServer, useServerTools } from "@/hooks/useServers";
import { api } from "@/lib/api/client";
import { routes } from "@/lib/api-routes";
import {
  argsToArrayOrNull,
  entriesToRecordOrNull,
  findDuplicateHeaderKeys,
  findDuplicateKeys,
  headerEntriesToRecordOrNull,
  type KeyValueEntries,
} from "@/lib/server-form";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ConnectionType, ServerDetail as ServerDetailDto } from "@moor/types";

export interface EditForm {
  name: string;
  command: string;
  url: string;
  args: string;
  env: Array<[string, string]>;
  headers: Array<[string, string]>;
  workingDir: string;
}

function serverToForm(server: ServerDetailDto): EditForm {
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

function validateEditForm(form: EditForm, connectionType: ConnectionType): string | null {
  if (!form.name.trim()) return "Name is required.";
  if (connectionType === "stdio" && !form.command.trim()) return "Command is required.";
  if (connectionType === "http" && !form.url.trim()) return "URL is required.";
  if (findDuplicateKeys(form.env).size > 0) return "Environment variable keys must be unique.";
  if (connectionType === "http" && findDuplicateHeaderKeys(form.headers).size > 0) {
    return "HTTP header keys must be unique.";
  }
  return null;
}

function formToUpdates(form: EditForm, connectionType: ConnectionType): Record<string, unknown> {
  const updates: Record<string, unknown> = { name: form.name.trim() };
  const env = entriesToRecordOrNull(form.env);

  // autoStart 由详情页 Switch 独立即时保存，不随编辑表单提交。
  if (connectionType === "stdio") {
    updates.command = form.command.trim();
    updates.args = argsToArrayOrNull(form.args);
    updates.env = env;
    updates.workingDir = form.workingDir.trim() || null;
    return updates;
  }

  updates.url = form.url.trim();
  updates.headers = headerEntriesToRecordOrNull(form.headers);
  updates.env = env;
  return updates;
}

function stableEntries(
  entries: KeyValueEntries,
  normalizeKey: (key: string) => string = (key) => key.trim(),
): KeyValueEntries {
  return entries
    .map(([key, value]) => [normalizeKey(key), value] as [string, string])
    .filter(([key]) => key)
    .sort(([a], [b]) => a.localeCompare(b));
}

function stableArgs(args: string): string[] {
  return args
    .split(/\r?\n/)
    .map((arg) => arg.trim())
    .filter(Boolean);
}

export function hasChanges(form: EditForm, baseline: EditForm): boolean {
  return (
    form.name.trim() !== baseline.name.trim() ||
    form.command.trim() !== baseline.command.trim() ||
    form.url.trim() !== baseline.url.trim() ||
    form.workingDir.trim() !== baseline.workingDir.trim() ||
    JSON.stringify(stableArgs(form.args)) !== JSON.stringify(stableArgs(baseline.args)) ||
    JSON.stringify(stableEntries(form.env)) !== JSON.stringify(stableEntries(baseline.env)) ||
    JSON.stringify(stableEntries(form.headers, (key) => key.trim().toLowerCase())) !==
      JSON.stringify(stableEntries(baseline.headers, (key) => key.trim().toLowerCase()))
  );
}

interface ServerEditFieldsProps {
  form: EditForm;
  connectionType: ConnectionType;
  onChange: (form: EditForm) => void;
}

export function ServerEditFields({ form, connectionType, onChange }: ServerEditFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Connection Type</Label>
          <Input
            value={connectionType}
            readOnly
            aria-disabled="true"
            className="capitalize bg-surface-300/50 cursor-not-allowed"
          />
          <p className="text-[11px] text-[var(--fg-40)]">Type cannot be changed after creation.</p>
        </div>
      </div>
      {connectionType === "stdio" ? (
        <>
          <div className="space-y-1.5">
            <Label>Command</Label>
            <Input
              placeholder="e.g., npx -y @modelcontextprotocol/server-github"
              value={form.command}
              onChange={(e) => onChange({ ...form, command: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Arguments (one per line)</Label>
            <Textarea
              placeholder={"-y\n@modelcontextprotocol/server-github"}
              value={form.args}
              onChange={(e) => onChange({ ...form, args: e.target.value })}
              className="min-h-[80px] font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Working Directory</Label>
            <Input
              placeholder="e.g., /path/to/project"
              value={form.workingDir}
              onChange={(e) => onChange({ ...form, workingDir: e.target.value })}
            />
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label>URL</Label>
            <Input
              placeholder="e.g., http://localhost:3000/mcp"
              value={form.url}
              onChange={(e) => onChange({ ...form, url: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>HTTP Headers</Label>
            <KeyValueEditor
              entries={form.headers}
              onChange={(headers) => onChange({ ...form, headers })}
              duplicateKeyFinder={findDuplicateHeaderKeys}
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
          entries={form.env}
          onChange={(env) => onChange({ ...form, env })}
          keyLabel="Variable"
          keyPlaceholder="API_KEY"
          valuePlaceholder="your-api-key"
        />
      </div>
    </>
  );
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
  const [baselineForm, setBaselineForm] = useState<EditForm | null>(null);
  const [baselineServer, setBaselineServer] = useState<ServerDetailDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [discardSource, setDiscardSource] = useState<"manual" | null>(null);
  const [overwriteOpen, setOverwriteOpen] = useState(false);

  const dirty = useMemo(
    () => (isEditing && editForm && baselineForm ? hasChanges(editForm, baselineForm) : false),
    [baselineForm, editForm, isEditing],
  );

  const blocker = useBlocker(dirty);
  const editConnectionType = baselineServer?.connectionType ?? server?.connectionType ?? "stdio";

  const exitEdit = useCallback(() => {
    setEditForm(null);
    setBaselineForm(null);
    setBaselineServer(null);
    setIsEditing(false);
  }, []);

  const enterEdit = useCallback(() => {
    if (!server) return;
    const nextForm = serverToForm(server);
    setEditForm(nextForm);
    setBaselineForm(nextForm);
    setBaselineServer(server);
    setIsEditing(true);
  }, [server]);

  const requestCancelEdit = useCallback(() => {
    if (dirty) {
      setDiscardSource("manual");
      return;
    }
    exitEdit();
  }, [dirty, exitEdit]);

  const saveEdit = useCallback(
    async (overwrite = false) => {
      if (!id || !editForm || !server || !baselineForm) return;
      const connectionType = baselineServer?.connectionType ?? server.connectionType;
      const validationError = validateEditForm(editForm, connectionType);
      if (validationError) {
        toast.error(validationError);
        return;
      }

      setSaving(true);
      try {
        if (!overwrite) {
          const latest = await api<ServerDetailDto>(routes.servers.detail(id));
          if (latest.connectionType !== connectionType) {
            toast.error("Save failed", {
              description: "Connection type changed. Reopen this server before saving.",
            });
            return;
          }
          if (hasChanges(serverToForm(latest), baselineForm)) {
            setOverwriteOpen(true);
            return;
          }
        }

        const updates = formToUpdates(editForm, connectionType);
        await updateServer({ id, updates });
        if (server?.status === "running") {
          toast.success("Configuration saved", {
            description: "Restart the server to apply changes.",
          });
        } else {
          toast.success("Configuration saved");
        }
        exitEdit();
      } catch (err) {
        toast.error("Save failed", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setSaving(false);
      }
    },
    [baselineForm, baselineServer, editForm, exitEdit, id, server, updateServer],
  );

  const confirmDiscard = useCallback(() => {
    setDiscardSource(null);
    if (blocker.state === "blocked") {
      blocker.proceed?.();
      return;
    }
    exitEdit();
  }, [blocker, exitEdit]);

  const cancelDiscard = useCallback(() => {
    setDiscardSource(null);
    if (blocker.state === "blocked") {
      blocker.reset?.();
    }
  }, [blocker]);

  const confirmOverwrite = useCallback(() => {
    setOverwriteOpen(false);
    void saveEdit(true);
  }, [saveEdit]);

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
      <UnsavedChangesDialog
        open={blocker.state === "blocked" || discardSource !== null}
        onCancel={cancelDiscard}
        onConfirm={confirmDiscard}
      />
      <UnsavedChangesDialog
        open={overwriteOpen}
        title="Overwrite external changes?"
        description="This server configuration changed while you were editing. Saving now will overwrite the latest saved configuration."
        actionLabel="Overwrite changes"
        onCancel={() => setOverwriteOpen(false)}
        onConfirm={confirmOverwrite}
      />

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
              <Button variant="outline" onClick={requestCancelEdit}>
                <X className="h-4 w-4 mr-2" /> Cancel
              </Button>
              <Button onClick={() => void saveEdit()} disabled={!dirty || saving}>
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
            <ServerEditFields
              form={editForm}
              connectionType={editConnectionType}
              onChange={(nextForm) => setEditForm(nextForm)}
            />
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

export function ToolCategoryBadge({ name }: { name: string }) {
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
