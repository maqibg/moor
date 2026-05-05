import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const CONNECTION_TYPES = [
  { value: "stdio", label: "stdio" },
  { value: "http", label: "HTTP/SSE" },
] as const;

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
    env: "",
    headers: "",
    autoStart: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!form.name || submitting) return;
    setFormError(null);

    let env: Record<string, string> | undefined;
    let headers: Record<string, string> | undefined;

    if (form.env) {
      try {
        env = JSON.parse(form.env) as Record<string, string>;
      } catch {
        setFormError("Invalid JSON in environment variables field");
        return;
      }
    }

    if (form.connectionType === "http" && form.headers) {
      try {
        headers = JSON.parse(form.headers) as Record<string, string>;
      } catch {
        setFormError("Invalid JSON in HTTP headers field");
        return;
      }
    }

    setSubmitting(true);
    try {
      await onAdd({
        name: form.name,
        connectionType: form.connectionType,
        command: form.connectionType === "stdio" ? form.command : undefined,
        args: form.args ? form.args.split(" ") : undefined,
        url: form.connectionType === "http" ? form.url : undefined,
        env,
        headers,
        autoStart: form.autoStart,
      });
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
              <Label>Arguments (space-separated)</Label>
              <Input
                placeholder="e.g., --port 3000"
                value={form.args}
                onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
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
              <Label>HTTP Headers (JSON, optional)</Label>
              <Input
                placeholder='{"Authorization":"Bearer {env:MCP_TOKEN}"}'
                value={form.headers}
                onChange={(e) => setForm((f) => ({ ...f, headers: e.target.value }))}
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
          <Label>Environment Variables (JSON, optional)</Label>
          <Input
            placeholder='{"API_KEY": "..."}'
            value={form.env}
            onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
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
          <Button onClick={handleSubmit} disabled={!form.name || submitting}>
            Add Server
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
