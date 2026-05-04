import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useProfiles } from "@/hooks/useProfiles";
import { Plus, Trash2, Check, Code, FlaskConical, User, Home } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

const profileIcons = [Code, FlaskConical, User, Home, Code, FlaskConical, User, Home];
const profileAccents = [
  "bg-cursor-orange/10 text-cursor-orange border-cursor-orange/20",
  "bg-grep/15 text-grep border-grep/20",
  "bg-read/15 text-read border-read/20",
  "bg-edit/15 text-edit border-edit/20",
];

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
    <div className="space-y-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-headline text-[28px] tracking-tight text-cursor-dark leading-tight">
            Profiles
          </h1>
          <p className="font-body text-sm text-[rgba(38,37,30,0.5)] mt-1.5">
            Manage server groupings and tool visibility
          </p>
        </div>
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Profile
          </Button>
        )}
      </div>

      {/* Create Form */}
      {creating && (
        <Card className="animate-scale-in border-cursor-orange/20">
          <CardContent className="p-4 flex items-center gap-3">
            <Input
              placeholder="Profile name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
              className="max-w-sm"
            />
            <Button onClick={handleCreate}>Create</Button>
            <Button
              variant="outline"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Profiles Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {profiles.map((profile, index) => {
          const Icon = profileIcons[index % profileIcons.length];
          const accent = profileAccents[index % profileAccents.length];
          return (
            <Card
              key={profile.id}
              className={cn(
                "group cursor-pointer transition-all duration-200 hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.06)]",
                profile.isActive
                  ? "ring-2 ring-cursor-orange/20 border-cursor-orange/30"
                  : "hover:border-[rgba(38,37,30,0.15)]",
              )}
              onClick={() => navigate(`/profiles/${profile.id}`)}
            >
              <CardContent className="p-5 relative">
                {profile.isActive && (
                  <div className="absolute top-4 right-4 text-cursor-orange">
                    <Check className="h-5 w-5" />
                  </div>
                )}
                <div
                  className={cn(
                    "h-10 w-10 rounded-xl flex items-center justify-center border mb-4 transition-colors",
                    accent,
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <h3 className="font-headline text-base text-cursor-dark mb-1">{profile.name}</h3>
                <p className="font-body text-xs text-[rgba(38,37,30,0.45)] mb-5">
                  {profile.isActive ? "Currently active" : "Click to manage"}
                </p>
                <div className="flex items-center gap-2 pt-4 border-t border-[rgba(38,37,30,0.06)]">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      profile.isActive ? "bg-success-muted" : "bg-[rgba(38,37,30,0.2)]",
                    )}
                  />
                  <span className="font-body text-xs text-[rgba(38,37,30,0.4)]">
                    {profile.serverCount ?? 0} servers
                  </span>
                </div>
                {/* Actions overlay */}
                <div
                  className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ opacity: profile.isActive ? undefined : undefined }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {!profile.isActive && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          activateProfile(profile.id);
                        }}
                      >
                        Activate
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-[rgba(38,37,30,0.35)] hover:text-error-warm"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteProfile(profile.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* New Profile CTA */}
        <button
          onClick={() => setCreating(true)}
          className={cn(
            "rounded-xl border-2 border-dashed border-[rgba(38,37,30,0.12)]",
            "flex flex-col items-center justify-center text-center min-h-[180px] p-5",
            "text-[rgba(38,37,30,0.35)] hover:text-cursor-orange hover:border-cursor-orange/30 hover:bg-cursor-orange/[0.02]",
            "transition-all duration-200 cursor-pointer group",
          )}
        >
          <div className="h-11 w-11 rounded-full bg-surface-300 group-hover:bg-cursor-orange/10 flex items-center justify-center mb-3 transition-colors">
            <Plus className="h-5 w-5" />
          </div>
          <h3 className="font-headline text-sm font-medium text-cursor-dark group-hover:text-cursor-orange transition-colors">
            New Profile
          </h3>
          <p className="font-body text-xs text-[rgba(38,37,30,0.4)] mt-1">
            Create a server grouping
          </p>
        </button>
      </div>
    </div>
  );
}
