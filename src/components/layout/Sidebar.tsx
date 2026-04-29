import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Server, FolderOpen, FileText, Settings, HelpCircle } from "lucide-react";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/servers", label: "Servers", icon: Server },
  { to: "/profiles", label: "Profiles", icon: FolderOpen },
  { to: "/logs", label: "Audit Logs", icon: FileText },
  { to: "/config", label: "Client Config", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="w-[220px] shrink-0 border-r border-[rgba(38,37,30,0.1)] bg-surface-300 flex flex-col">
      <div className="p-5 flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-cursor-dark flex items-center justify-center">
          <span className="text-surface-200 font-headline text-sm font-bold">M</span>
        </div>
        <div>
          <span className="font-headline text-lg tracking-tight text-cursor-dark leading-tight block">
            Moor
          </span>
          <span className="font-mono text-[10px] text-[rgba(38,37,30,0.4)] tracking-wide uppercase">
            MCP Manager
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl font-headline text-sm transition-all duration-200 relative group",
                isActive
                  ? "bg-surface-400 text-cursor-dark font-medium"
                  : "text-[rgba(38,37,30,0.55)] hover:bg-[rgba(38,37,30,0.06)] hover:text-cursor-dark",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-cursor-orange transition-all duration-200",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon
                  className={cn("h-4 w-4 transition-colors", isActive && "text-cursor-orange")}
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 mt-auto">
        <a
          href="https://github.com/modelcontextprotocol"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-headline text-sm text-[rgba(38,37,30,0.45)] hover:bg-[rgba(38,37,30,0.06)] hover:text-cursor-dark transition-all duration-200"
        >
          <HelpCircle className="h-4 w-4" />
          Documentation
        </a>
      </div>

      <div className="px-5 py-3 border-t border-[rgba(38,37,30,0.08)]">
        <p className="font-mono text-[10px] text-[rgba(38,37,30,0.3)]">{`Moor v${__APP_VERSION__}`}</p>
      </div>
    </aside>
  );
}
