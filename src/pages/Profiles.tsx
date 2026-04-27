import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProfiles } from "@/hooks/useProfiles";
import { Plus, Trash2, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function Profiles() {
  const { profiles, createProfile, activateProfile, deleteProfile } = useProfiles();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createProfile(newName.trim());
    setNewName("");
    setCreating(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-2xl tracking-tight text-cursor-dark">Profiles</h1>
          <p className="font-body text-sm text-[rgba(38,37,30,0.55)] mt-1">Manage server groupings and tool visibility</p>
        </div>
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Profile
          </Button>
        )}
      </div>

      {creating && (
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Input
              placeholder="Profile name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            <Button onClick={handleCreate}>Create</Button>
            <Button variant="outline" onClick={() => { setCreating(false); setNewName(""); }}>Cancel</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        {profiles.map((profile) => (
          <Card
            key={profile.id}
            className={`cursor-pointer hover:shadow-[rgba(0,0,0,0.02)_0px_0px_16px,rgba(0,0,0,0.008)_0px_0px_8px] transition-shadow ${profile.is_active ? "ring-2 ring-[rgba(38,37,30,0.2)]" : ""}`}
            onClick={() => navigate(`/profiles/${profile.id}`)}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-headline text-base text-cursor-dark">{profile.name}</span>
                  {profile.is_active ? (
                    <Badge variant="success"><Check className="h-3 w-3 mr-1" /> Active</Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-body text-xs text-[rgba(38,37,30,0.4)]">
                    {profile.server_count ?? 0} servers
                  </span>
                  {!profile.is_active && (
                    <>
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); activateProfile(profile.id); }}>
                        Activate
                      </Button>
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteProfile(profile.id); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
