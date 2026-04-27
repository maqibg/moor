import { useProfiles } from "@/hooks/useProfiles";
import { ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export function Header() {
  const { profiles, activateProfile } = useProfiles();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activeProfile = profiles.find((p) => p.is_active);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <header className="h-14 border-b border-[rgba(38,37,30,0.1)] bg-surface-200 flex items-center justify-between px-6">
      <div className="flex items-center gap-2">
        <span className="font-body text-sm text-[rgba(38,37,30,0.55)]">Active Profile:</span>
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-300 hover:bg-surface-400 transition-colors font-headline text-sm text-cursor-dark"
          >
            <div className="h-2 w-2 rounded-full bg-success-muted" />
            {activeProfile?.name || "None"}
            <ChevronDown className="h-3.5 w-3.5 text-[rgba(38,37,30,0.4)]" />
          </button>
          {open && (
            <div className="absolute top-full mt-1 left-0 z-50 w-48 rounded-lg border border-[rgba(38,37,30,0.1)] bg-surface-200 shadow-lg py-1">
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => {
                    activateProfile(profile.id);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm font-headline hover:bg-surface-300 transition-colors ${
                    profile.is_active
                      ? "text-cursor-dark font-medium"
                      : "text-[rgba(38,37,30,0.55)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {profile.is_active && (
                      <div className="h-1.5 w-1.5 rounded-full bg-success-muted" />
                    )}
                    {profile.name}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
