import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Server, FolderOpen, FileText, Settings } from "lucide-react";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/servers", label: "Servers", icon: Server },
  { to: "/profiles", label: "Profiles", icon: FolderOpen },
  { to: "/logs", label: "Audit Logs", icon: FileText },
  { to: "/config", label: "Client Config", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r border-[rgba(38,37,30,0.1)] bg-surface-300 flex flex-col">
      <div className="p-5 flex items-center gap-2.5">
        <div className="h-7 w-7 rounded-lg bg-cursor-dark flex items-center justify-center">
          <span className="text-surface-200 font-headline text-xs font-bold">M</span>
        </div>
        <span className="font-headline text-lg tracking-tight text-cursor-dark">Moor</span>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg font-headline text-sm transition-colors",
                isActive
                  ? "bg-surface-400 text-cursor-dark"
                  : "text-[rgba(38,37,30,0.55)] hover:bg-[rgba(38,37,30,0.06)] hover:text-cursor-dark"
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-[rgba(38,37,30,0.1)]">
        <p className="font-mono text-[10px] text-[rgba(38,37,30,0.35)]">Moor v0.1.0</p>
      </div>
    </aside>
  );
}
