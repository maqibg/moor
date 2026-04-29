import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Server, FolderOpen } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { useProfiles, type Profile } from "@/hooks/useProfiles";
import { useApi } from "@/hooks/useApi";
import type { Server as ServerType } from "@/hooks/useServers";
import { cn } from "@/lib/utils";

interface ProfileServerState {
  enabled: boolean;
  disabled_tools: string[];
}

interface ProfileDetailData extends Profile {
  servers: Array<ServerType & { profile_server: ProfileServerState }>;
}

export function ProfileDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { updateProfileServer } = useProfiles();
  const {
    data: profile,
    loading,
    refresh,
  } = useApi<ProfileDetailData | null>(`/api/profiles/${id ?? ""}`, null);

  if (loading) {
    return (
      <div className="py-16 text-center animate-fade-in">
        <div className="h-8 w-8 mx-auto rounded-full border-2 border-[rgba(38,37,30,0.1)] border-t-cursor-orange animate-spin mb-4" />
        <p className="font-body text-sm text-[rgba(38,37,30,0.4)]">Loading profile...</p>
      </div>
    );
  }

  if (!profile || !id) {
    return (
      <div className="py-16 text-center">
        <FolderOpen className="h-10 w-10 mx-auto text-[rgba(38,37,30,0.15)] mb-4" />
        <p className="font-body text-sm text-[rgba(38,37,30,0.4)]">Profile not found</p>
      </div>
    );
  }

  const toggleServer = async (serverId: string, enabled: boolean) => {
    await updateProfileServer(id, serverId, { enabled });
    refresh();
  };

  const enabledCount = profile.servers.filter((s) => s.profile_server.enabled).length;

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 mt-0.5"
          onClick={() => navigate("/profiles")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="font-headline text-[28px] tracking-tight text-cursor-dark leading-tight">
              {profile.name}
            </h1>
            {profile.is_active ? (
              <Badge variant="success">
                <span className="relative flex h-1.5 w-1.5 mr-1.5">
                  <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-success-muted opacity-50" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success-muted" />
                </span>
                Active
              </Badge>
            ) : null}
          </div>
          <p className="font-body text-sm text-[rgba(38,37,30,0.45)] mt-1">
            {enabledCount} of {profile.servers.length} servers enabled
          </p>
        </div>
      </div>

      {/* Server Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4 text-[rgba(38,37,30,0.4)]" /> Server Selection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {profile.servers.length === 0 ? (
            <div className="py-10 text-center">
              <Server className="h-8 w-8 mx-auto text-[rgba(38,37,30,0.15)] mb-3" />
              <p className="font-body text-sm text-[rgba(38,37,30,0.35)]">
                No servers available. Add servers first.
              </p>
            </div>
          ) : (
            profile.servers.map((server) => (
              <div
                key={server.id}
                className={cn(
                  "flex items-center justify-between py-3 px-4 rounded-xl transition-all duration-200",
                  server.profile_server.enabled
                    ? "bg-surface-100 border border-[rgba(38,37,30,0.08)]"
                    : "hover:bg-surface-300/40",
                )}
              >
                <div className="flex items-center gap-3">
                  <Switch
                    checked={server.profile_server.enabled}
                    onCheckedChange={(v) => toggleServer(server.id, v)}
                  />
                  <div
                    className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center border shrink-0",
                      server.status === "running"
                        ? "bg-success-muted/8 text-success-muted border-success-muted/15"
                        : "bg-surface-300 text-[rgba(38,37,30,0.3)] border-[rgba(38,37,30,0.06)]",
                    )}
                  >
                    <Server className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <span className="font-headline text-sm text-cursor-dark">{server.name}</span>
                    <Badge variant="subtle" className="ml-2 text-[10px]">
                      {server.connection_type}
                    </Badge>
                  </div>
                </div>
                {server.profile_server.enabled && (
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-success-muted" />
                    <span className="font-body text-xs text-[rgba(38,37,30,0.4)]">Enabled</span>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
