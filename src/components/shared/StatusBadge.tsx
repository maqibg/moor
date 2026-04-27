import { Badge } from "@/components/ui/badge";

const statusConfig = {
  stopped: { label: "Stopped", variant: "default" as const },
  starting: { label: "Starting", variant: "warning" as const },
  running: { label: "Running", variant: "success" as const },
  error: { label: "Error", variant: "error" as const },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.stopped;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
