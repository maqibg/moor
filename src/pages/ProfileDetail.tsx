import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Server } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { useProfiles, type Profile } from "@/hooks/useProfiles";
import { useApi } from "@/hooks/useApi";
import type { Server as ServerType } from "@/hooks/useServers";

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
      <p className="font-body text-sm text-[rgba(38,37,30,0.4)] py-8 text-center">Loading...</p>
    );
  }

  if (!profile || !id) {
    return (
      <p className="font-body text-sm text-[rgba(38,37,30,0.4)] py-8 text-center">
        Profile not found
      </p>
    );
  }

  const toggleServer = async (serverId: string, enabled: boolean) => {
    await updateProfileServer(id, serverId, { enabled });
    refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/profiles")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline text-2xl tracking-tight text-cursor-dark">
              {profile.name}
            </h1>
            {profile.is_active ? <Badge variant="success">Active</Badge> : null}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" /> Server Selection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {profile.servers.length === 0 ? (
            <p className="font-body text-sm text-[rgba(38,37,30,0.4)] py-4 text-center">
              No servers available. Add servers first.
            </p>
          ) : (
            profile.servers.map((server) => (
              <div
                key={server.id}
                className="flex items-center justify-between py-2 border-b border-[rgba(38,37,30,0.06)] last:border-0"
              >
                <div className="flex items-center gap-2">
                  <Switch
                    checked={server.profile_server.enabled}
                    onCheckedChange={(v) => toggleServer(server.id, v)}
                  />
                  <span className="font-headline text-sm text-cursor-dark">{server.name}</span>
                  <Badge variant="outline">{server.connection_type}</Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
