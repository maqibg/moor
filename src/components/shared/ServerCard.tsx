import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import { Play, Square, Trash2, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Server } from "@/hooks/useServers";

export function ServerCard({ server, onStart, onStop, onRemove }: {
  server: Server;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const navigate = useNavigate();

  return (
    <Card className="hover:shadow-[rgba(0,0,0,0.02)_0px_0px_16px,rgba(0,0,0,0.008)_0px_0px_8px] transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-headline text-sm font-medium text-cursor-dark truncate">{server.name}</span>
                <StatusBadge status={server.status} />
              </div>
              <span className="font-mono text-xs text-[rgba(38,37,30,0.4)] truncate">
                {server.connection_type === "stdio"
                  ? `${server.command} ${(server.args || []).join(" ")}`
                  : server.url}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {server.status === "running" ? (
              <Button variant="ghost" size="icon" onClick={() => onStop(server.id)} title="Stop">
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" onClick={() => onStart(server.id)} title="Start">
                <Play className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => navigate(`/servers/${server.id}`)} title="Settings">
              <Settings className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onRemove(server.id)} title="Remove">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
