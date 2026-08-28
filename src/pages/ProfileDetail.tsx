import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Server,
  FolderOpen,
  Search,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useProfiles, useProfile, useProfileTools } from "@/hooks/useProfiles";
import { DetailPageHeader } from "@/components/shared/DetailPageHeader";
import { PageLoading } from "@/components/shared/PageLoading";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";
import type { ProfileServerUpsert, ProfileToolGroup, ToolDetail } from "@moor/types";

export function ProfileDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { updateProfileServer, isUpdatingServer } = useProfiles();
  const { profile, isLoading: loading, refresh } = useProfile(id);

  if (loading) {
    return <PageLoading message="Loading profile..." />;
  }

  if (!profile || !id) {
    return <EmptyState icon={FolderOpen} message="Profile not found" />;
  }

  const toggleServer = async (serverId: string, enabled: boolean) => {
    try {
      await updateProfileServer({ profileId: id, serverId, updates: { enabled } });
    } catch {
      // 失败提示由全局 MutationCache onError 兜底
      return;
    }
    refresh();
  };

  const enabledCount = profile.servers.filter((s) => s.profileServer.enabled).length;

  return (
    <div className="space-y-6 animate-fade-in-up">
      <DetailPageHeader
        title={profile.name}
        subtitle={`${enabledCount} of ${profile.servers.length} servers enabled`}
        badge={
          profile.isActive ? (
            <Badge variant="success">
              <span className="relative flex h-1.5 w-1.5 mr-1.5">
                <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-success-muted opacity-50" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success-muted" />
              </span>
              Active
            </Badge>
          ) : undefined
        }
        onBack={() => navigate("/profiles")}
      />

      {/* Server Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4 text-[var(--fg-40)]" /> Server Selection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {profile.servers.length === 0 ? (
            <EmptyState icon={Server} message="No servers available. Add servers first." />
          ) : (
            profile.servers.map((server) => (
              <div
                key={server.id}
                className={cn(
                  "flex items-center justify-between py-3 px-4 rounded-xl transition-all duration-200",
                  server.profileServer.enabled
                    ? "bg-surface-100 border border-[var(--fg-08)]"
                    : "hover:bg-surface-300/40",
                )}
              >
                <div className="flex items-center gap-3">
                  <Switch
                    checked={server.profileServer.enabled}
                    disabled={isUpdatingServer}
                    onCheckedChange={(v) => toggleServer(server.id, v)}
                  />
                  <div
                    className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center border shrink-0",
                      server.status === "running"
                        ? "bg-success-muted/8 text-success-muted border-success-muted/15"
                        : "bg-surface-300 text-[var(--fg-30)] border-[var(--fg-06)]",
                    )}
                  >
                    <Server className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <span className="font-headline text-sm text-cursor-dark">{server.name}</span>
                    <Badge variant="subtle" className="ml-2 text-[10px]">
                      {server.connectionType}
                    </Badge>
                  </div>
                </div>
                {server.profileServer.enabled && (
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-success-muted" />
                    <span className="font-body text-xs text-[var(--fg-40)]">Enabled</span>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Tool Governance */}
      <ToolGovernanceCard profileId={id} />
    </div>
  );
}

interface ToolSelection {
  serverId: string;
  toolName: string;
}

function ToolGovernanceCard({ profileId }: { profileId: string }) {
  const { groups, isLoading } = useProfileTools(profileId);
  const { updateProfileServer, updateProfileServers, isUpdatingServer, isUpdatingServers } =
    useProfiles();
  // 快照覆盖语义下，任一写进行中都冻结治理操作，杜绝并发丢更新
  const governanceBusy = isUpdatingServer || isUpdatingServers;
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<ToolSelection[]>([]);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const focusServerId = searchParams.get("serverId") ?? undefined;
  const focusToolName = searchParams.get("toolName") ?? undefined;

  // 洞察面板跳转定位：展开目标 server 组，滚动到工具行并短暂高亮
  useEffect(() => {
    if (!groups.length || !focusServerId) return;
    setExpanded((prev) => new Set(prev).add(focusServerId));
    if (!focusToolName) return;
    const rowId = toolRowId(focusServerId, focusToolName);
    let clearHighlight: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      document.getElementById(rowId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlighted(rowId);
      clearHighlight = setTimeout(() => setHighlighted(null), 2600);
    }, 150);
    return () => {
      clearTimeout(timer);
      if (clearHighlight !== undefined) clearTimeout(clearHighlight);
    };
    // 仅在矩阵数据到达时定位一次；搜索参数的消费由 setSearchParams 清理
  }, [groups, focusServerId, focusToolName]);

  useEffect(() => {
    if (focusServerId && groups.length > 0) {
      setSearchParams({}, { replace: true });
    }
  }, [focusServerId, groups.length, setSearchParams]);

  const trimmed = search.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!trimmed) return groups;
    return groups
      .map((group) => {
        const serverMatches = group.serverName.toLowerCase().includes(trimmed);
        if (serverMatches) return group;
        const tools = group.tools.filter(
          (tool) =>
            tool.toolName.toLowerCase().includes(trimmed) ||
            tool.exposedName.toLowerCase().includes(trimmed) ||
            (tool.description ?? "").toLowerCase().includes(trimmed),
        );
        return tools.length > 0 ? { ...group, tools } : null;
      })
      .filter((group): group is ProfileToolGroup => group !== null);
  }, [groups, trimmed]);

  const isExpanded = (serverId: string) => trimmed.length > 0 || expanded.has(serverId);
  const toggleExpanded = (serverId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
      }
      return next;
    });
  };

  const isSelected = (serverId: string, toolName: string) =>
    selection.some((item) => item.serverId === serverId && item.toolName === toolName);

  const toggleSelected = (serverId: string, toolName: string) => {
    setSelection((prev) =>
      prev.some((item) => item.serverId === serverId && item.toolName === toolName)
        ? prev.filter((item) => !(item.serverId === serverId && item.toolName === toolName))
        : [...prev, { serverId, toolName }],
    );
  };

  const allFilteredTools = useMemo(
    () =>
      filteredGroups.flatMap((group) =>
        group.tools.map((tool) => ({ serverId: group.serverId, toolName: tool.toolName })),
      ),
    [filteredGroups],
  );

  // 反选仅作用于当前过滤视图：未选中的纳入、已选中的移除，视图外选择保持不变
  const invertFilteredSelection = () => {
    const filteredKeys = new Set(allFilteredTools.map((tool) => toolKey(tool)));
    const selectedKeys = new Set(selection.map((item) => toolKey(item)));
    const kept = selection.filter((item) => !filteredKeys.has(toolKey(item)));
    const added = allFilteredTools.filter((tool) => !selectedKeys.has(toolKey(tool)));
    setSelection([...kept, ...added]);
  };

  const restore = async (snapshot: ProfileServerUpsert[], description: string) => {
    try {
      await updateProfileServers({ profileId, updates: snapshot });
    } catch {
      // 失败提示由全局 MutationCache onError 兜底
      return;
    }
    toast.success(description);
  };

  const toggleTool = async (group: ProfileToolGroup, toolName: string, enabled: boolean) => {
    try {
      await updateProfileServer({
        profileId,
        serverId: group.serverId,
        updates: {
          disabledTools: disabledToolsOf(group, (tool) =>
            tool.toolName === toolName ? enabled : !tool.disabled,
          ),
        },
      });
    } catch {
      // 失败提示由全局 MutationCache onError 兜底
    }
  };

  const setServerTools = async (group: ProfileToolGroup, enable: boolean) => {
    const before = disabledToolsOf(group, () => false);
    try {
      await updateProfileServer({
        profileId,
        serverId: group.serverId,
        updates: { disabledTools: disabledToolsOf(group, () => enable) },
      });
    } catch {
      return;
    }
    toast.success(
      enable
        ? `Enabled all tools in ${group.serverName}`
        : `Disabled all tools in ${group.serverName}`,
      {
        action: {
          label: "Undo",
          onClick: () =>
            void restore(
              [{ serverId: group.serverId, disabledTools: before }],
              `Restored tools in ${group.serverName}`,
            ),
        },
      },
    );
  };

  const applySelection = async (enable: boolean) => {
    if (selection.length === 0) return;
    // 选中项按 server 分组，各自计算整组 disabledTools 快照（批量接口按 server 全量替换）
    const byServer = new Map<string, { group: ProfileToolGroup; selected: Set<string> }>();
    for (const item of selection) {
      const group = groups.find((g) => g.serverId === item.serverId);
      if (!group) continue;
      const entry = byServer.get(item.serverId) ?? { group, selected: new Set<string>() };
      entry.selected.add(item.toolName);
      byServer.set(item.serverId, entry);
    }
    const before: ProfileServerUpsert[] = [];
    const updates: ProfileServerUpsert[] = [];
    for (const { group, selected } of byServer.values()) {
      before.push({
        serverId: group.serverId,
        disabledTools: disabledToolsOf(group, () => false),
      });
      updates.push({
        serverId: group.serverId,
        disabledTools: disabledToolsOf(group, (tool) =>
          selected.has(tool.toolName) ? enable : !tool.disabled,
        ),
      });
    }
    const count = selection.length;
    setSelection([]);
    try {
      await updateProfileServers({ profileId, updates });
    } catch {
      return;
    }
    toast.success(enable ? `Enabled ${count} tools` : `Disabled ${count} tools`, {
      action: {
        label: "Undo",
        onClick: () => void restore(before, "Restored previous tool states"),
      },
    });
  };

  const totalTools = groups.reduce((sum, group) => sum + group.tools.length, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--fg-40)]" /> Tool Governance
          <Badge variant="subtle">{totalTools} tools</Badge>
        </CardTitle>
        <div className="flex items-center gap-3 flex-wrap pt-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--fg-30)]" />
            <Input
              placeholder="Search tools, servers, descriptions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {selection.length > 0 && (
            <>
              <span className="font-body text-xs text-[var(--fg-45)]">
                {selection.length} selected
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={governanceBusy}
                onClick={() => void applySelection(true)}
              >
                Enable
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={governanceBusy}
                onClick={() => void applySelection(false)}
              >
                Disable
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelection([])}
                className="h-7 px-2 text-xs"
              >
                <X className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
            </>
          )}
          {allFilteredTools.length > 0 && (
            <>
              {selection.length === 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSelection(allFilteredTools)}
                >
                  Select all {trimmed ? "filtered" : ""}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={invertFilteredSelection}
              >
                Invert {trimmed ? "filtered" : "all"}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? (
          <EmptyState icon={SlidersHorizontal} message="Loading tools..." />
        ) : groups.length === 0 ? (
          <EmptyState icon={Server} message="No servers available. Add servers first." />
        ) : filteredGroups.length === 0 ? (
          <EmptyState icon={Search} message="No tools match your search." />
        ) : (
          filteredGroups.map((group) => (
            <ToolGroupSection
              key={group.serverId}
              group={group}
              expanded={isExpanded(group.serverId)}
              highlighted={highlighted}
              disabled={governanceBusy}
              selectionCount={selection.filter((item) => item.serverId === group.serverId).length}
              isSelected={isSelected}
              onToggleExpanded={() => toggleExpanded(group.serverId)}
              onToggleTool={(toolName, enabled) => void toggleTool(group, toolName, enabled)}
              onSetAllTools={(enable) => void setServerTools(group, enable)}
              onToggleSelected={(toolName) => toggleSelected(group.serverId, toolName)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function toolRowId(serverId: string, toolName: string) {
  return `tool-${serverId}-${toolName}`;
}

// 批量接口以 server 为单位整体覆盖禁用清单；isEnabled 判定各工具启用态后统一推导
function disabledToolsOf(group: ProfileToolGroup, isEnabled: (tool: ToolDetail) => boolean) {
  return group.tools.filter((tool) => !isEnabled(tool)).map((tool) => tool.toolName);
}

const toolKey = (tool: { serverId: string; toolName: string }) =>
  `${tool.serverId}\u0000${tool.toolName}`;

function ToolGroupSection({
  group,
  expanded,
  highlighted,
  disabled,
  selectionCount,
  isSelected,
  onToggleExpanded,
  onToggleTool,
  onSetAllTools,
  onToggleSelected,
}: {
  group: ProfileToolGroup;
  expanded: boolean;
  highlighted: string | null;
  disabled: boolean;
  selectionCount: number;
  isSelected: (serverId: string, toolName: string) => boolean;
  onToggleExpanded: () => void;
  onToggleTool: (toolName: string, enabled: boolean) => void;
  onSetAllTools: (enable: boolean) => void;
  onToggleSelected: (toolName: string) => void;
}) {
  const enabledTools = group.tools.filter((tool) => !tool.disabled).length;
  const allEnabled = group.tools.length > 0 && enabledTools === group.tools.length;
  const noneEnabled = enabledTools === 0;

  return (
    <div className="rounded-xl border border-[var(--fg-06)] overflow-hidden">
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 transition-colors",
          group.serverEnabled ? "bg-surface-100" : "bg-surface-300/30",
        )}
      >
        <button onClick={onToggleExpanded} className="text-[var(--fg-40)] hover:text-cursor-dark">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-headline text-sm text-cursor-dark">{group.serverName}</span>
            {group.serverEnabled ? (
              <Badge variant="subtle" className="text-[10px]">
                {enabledTools}/{group.tools.length} tools
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                Server disabled — tools hidden from agents
              </Badge>
            )}
          </div>
        </div>
        {selectionCount > 0 && (
          <Badge variant="success" className="text-[10px]">
            {selectionCount} selected
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={disabled || allEnabled}
          onClick={() => onSetAllTools(true)}
        >
          Enable all
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={disabled || noneEnabled}
          onClick={() => onSetAllTools(false)}
        >
          Disable all
        </Button>
      </div>
      {expanded && (
        <div className="divide-y divide-[var(--fg-04)]">
          {group.tools.length === 0 ? (
            <p className="px-4 py-3 font-body text-xs text-[var(--fg-40)]">
              No tools discovered for this server yet.
            </p>
          ) : (
            group.tools.map((tool) => (
              <ToolRow
                key={tool.toolName}
                serverId={group.serverId}
                tool={tool}
                highlighted={highlighted === toolRowId(group.serverId, tool.toolName)}
                disabled={disabled}
                selected={isSelected(group.serverId, tool.toolName)}
                onToggleSelected={() => onToggleSelected(tool.toolName)}
                onToggleTool={(enabled) => onToggleTool(tool.toolName, enabled)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ToolRow({
  serverId,
  tool,
  highlighted,
  disabled,
  selected,
  onToggleSelected,
  onToggleTool,
}: {
  serverId: string;
  tool: ToolDetail;
  highlighted: boolean;
  disabled: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onToggleTool: (enabled: boolean) => void;
}) {
  return (
    <div
      id={toolRowId(serverId, tool.toolName)}
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 transition-all",
        highlighted && "ring-2 ring-cursor-orange/40 bg-cursor-orange/5 rounded-lg",
        !tool.disabled ? "" : "opacity-60",
      )}
    >
      <Checkbox checked={selected} onCheckedChange={() => onToggleSelected()} />
      <Switch
        checked={!tool.disabled}
        disabled={disabled}
        onCheckedChange={(v) => onToggleTool(v)}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-cursor-dark truncate">{tool.toolName}</span>
          {tool.exposedName !== tool.toolName && (
            <span className="font-mono text-[10px] text-[var(--fg-35)] truncate">
              → {tool.exposedName}
            </span>
          )}
        </div>
        {tool.description && (
          <p className="font-body text-[11px] text-[var(--fg-40)] truncate">{tool.description}</p>
        )}
      </div>
      {!tool.disabled && (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-success-muted" />
          <span className="font-body text-[11px] text-[var(--fg-40)]">Visible</span>
        </div>
      )}
    </div>
  );
}
