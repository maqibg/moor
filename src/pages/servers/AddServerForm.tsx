import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { AlertTriangle, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { KeyValueEditor } from "@/components/shared/KeyValueEditor";

const CONNECTION_TYPES = [
  { value: "stdio", label: "stdio" },
  { value: "http", label: "HTTP/SSE" },
] as const;

function entriesToRecord(entries: Array<[string, string]>): Record<string, string> | undefined {
  const record: Record<string, string> = {};
  for (const [key, value] of entries) {
    const trimmedKey = key.trim();
    if (trimmedKey) {
      record[trimmedKey] = value;
    }
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

function argsToArray(args: string): string[] | undefined {
  const parsed = args
    .split("\n")
    .map((arg) => arg.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

interface AddServerFormProps {
  onAdd: (config: {
    name: string;
    connectionType: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    autoStart?: boolean;
  }) => Promise<void>;
  onClose: () => void;
}

export function AddServerForm({ onAdd, onClose }: AddServerFormProps) {
  const [form, setForm] = useState({
    name: "",
    connectionType: "stdio" as "stdio" | "http",
    command: "",
    args: "",
    url: "",
    env: [] as Array<[string, string]>,
    headers: [] as Array<[string, string]>,
    autoStart: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!form.name.trim() || submitting) return;
    setFormError(null);

    setSubmitting(true);
    try {
      const env = entriesToRecord(form.env);

      const baseConfig = {
        name: form.name.trim(),
        connectionType: form.connectionType,
        autoStart: form.autoStart,
        env,
      };

      await onAdd(
        form.connectionType === "stdio"
          ? {
              ...baseConfig,
              connectionType: "stdio",
              command: form.command.trim(),
              args: argsToArray(form.args),
            }
          : {
              ...baseConfig,
              connectionType: "http",
              url: form.url.trim(),
              headers: entriesToRecord(form.headers),
            },
      );
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add server");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="animate-scale-in border-cursor-orange/20 shadow-[0_8px_30px_rgba(245,78,0,0.04)]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Add New Server</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="text-[var(--fg-65)] hover:text-cursor-dark hover:bg-[var(--fg-08)]"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              placeholder="e.g., github"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={form.connectionType}
              onValueChange={(value) =>
                setForm((f) => ({ ...f, connectionType: value as "stdio" | "http" }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {CONNECTION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {form.connectionType === "stdio" ? (
          <>
            <div className="space-y-1.5">
              <Label>Command</Label>
              <Input
                placeholder="e.g., npx -y @modelcontextprotocol/server-github"
                value={form.command}
                onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Arguments (one per line)</Label>
              <Textarea
                placeholder={"-y\n@modelcontextprotocol/server-github"}
                value={form.args}
                onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                className="min-h-[80px] font-mono text-xs"
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
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>HTTP Headers</Label>
              <KeyValueEditor
                entries={form.headers}
                onChange={(headers) => setForm((f) => ({ ...f, headers }))}
                keyLabel="Header"
                keyPlaceholder="Authorization"
                valuePlaceholder="Bearer {env:MCP_TOKEN}"
              />
            </div>
          </>
        )}
        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label>Auto Start</Label>
            <p className="text-[11px] text-[var(--fg-40)]">
              Automatically start this server when Moor launches
            </p>
          </div>
          <Switch
            checked={form.autoStart}
            onCheckedChange={(v) => setForm((f) => ({ ...f, autoStart: v }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Environment Variables</Label>
          <KeyValueEditor
            entries={form.env}
            onChange={(env) => setForm((f) => ({ ...f, env }))}
            keyPlaceholder="API_KEY"
            valuePlaceholder="your-api-key"
          />
        </div>
        {formError && (
          <div className="flex items-center gap-2 rounded-lg border border-error-warm/20 bg-error-warm/8 px-3 py-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-error-warm" />
            <p className="font-body text-xs text-error-warm">{formError}</p>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!form.name.trim() || submitting}>
            Add Server
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
