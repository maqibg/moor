import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Server, FolderOpen, Copy, Wrench } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { useProfile } from "@/hooks/useProfiles";
import { useProfileGovernance } from "@/hooks/useProfileGovernance";
import { DetailPageHeader } from "@/components/shared/DetailPageHeader";
import { PageLoading } from "@/components/shared/PageLoading";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn, getErrorMessage } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";
import {
  type GovernanceDraft,
  buildGovernanceDraft,
  diffGovernanceDraft,
  mergeHiddenDisabledTools,
  toggleDraftTool,
} from "@/lib/profile-governance";

export function ProfileDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { profile, isLoading: loading } = useProfile(id);
  const {
    groups,
    loading: groupsLoading,
    error: groupsError,
    save,
    clone,
  } = useProfileGovernance(id);
  const [draft, setDraft] = useState<GovernanceDraft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cloneFormOpen, setCloneFormOpen] = useState(false);
  const [cloneName, setCloneName] = useState("");

  // profile 详情里的 disabledTools 是权威整表（包含已不再被发现的工具名），
  // 工具矩阵只能看到已发现的行，提交时用权威表兜住看不见的部分。
  const authoritativeDisabledTools = useMemo(() => {
    const baseline: Record<string, string[]> = {};
    for (const server of profile?.servers ?? []) {
      baseline[server.id] = server.profileServer.disabledTools;
    }
    return baseline;
  }, [profile]);

  // 只在首次拿到数据或保存后（draft 置空）从服务端重建草稿，避免后台刷新吞掉未保存的编辑。
  useEffect(() => {
    if (!draft && groups.length > 0) {
      setDraft(buildGovernanceDraft(groups));
    }
  }, [draft, groups]);

  if (loading) {
    return <PageLoading message={t("Loading profile...")} />;
  }

  if (!profile || !id) {
    return <EmptyState icon={FolderOpen} message={t("Profile not found")} />;
  }

  // 服务器启用/禁用也走 servers-state 批量端点，写入后把结果同步进草稿，
  // 避免治理卡片里同名的「服务器启用」开关显示互相矛盾的状态。
  const toggleServer = async (serverId: string, enabled: boolean) => {
    try {
      setActionError(null);
      await save.mutateAsync([{ serverId, enabled }]);
      setDraft((current) =>
        current?.[serverId]
          ? { ...current, [serverId]: { ...current[serverId], enabled } }
          : current,
      );
    } catch (err) {
      setActionError(getErrorMessage(err, t("Failed to update server state")));
    }
  };

  const changes = draft ? diffGovernanceDraft(groups, draft) : [];

  const handleSaveGovernance = async () => {
    if (changes.length === 0) return;
    try {
      setActionError(null);
      await save.mutateAsync(mergeHiddenDisabledTools(changes, groups, authoritativeDisabledTools));
      setDraft(null);
    } catch (err) {
      setActionError(getErrorMessage(err, t("Failed to update tool governance")));
    }
  };

  // 克隆用页面内表单而不是弹窗：与列表页的创建/克隆入口保持一致的交互方式。
  const openCloneForm = () => {
    setActionError(null);
    setCloneName(t("{{name}} copy", { name: profile.name }));
    setCloneFormOpen(true);
  };

  const submitClone = async () => {
    const name = cloneName.trim();
    if (name.length === 0) return;
    try {
      setActionError(null);
      const created = await clone.mutateAsync(name);
      setCloneFormOpen(false);
      navigate(`/profiles/${created.id}`);
    } catch (err) {
      setActionError(getErrorMessage(err, t("Failed to clone profile")));
    }
  };

  const enabledCount = profile.servers.filter((s) => s.profileServer.enabled).length;

  return (
    <div className="space-y-6 animate-fade-in-up">
      <DetailPageHeader
        title={profile.name}
        subtitle={t("{{enabled}} of {{total}} servers enabled", {
          enabled: String(enabledCount),
          total: String(profile.servers.length),
        })}
        badge={
          profile.isActive ? (
            <Badge variant="success">
              <span className="relative flex h-1.5 w-1.5 mr-1.5">
                <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-success-muted opacity-50" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success-muted" />
              </span>
              {t("Active")}
            </Badge>
          ) : undefined
        }
        onBack={() => navigate("/profiles")}
      />

      {actionError && <ErrorBanner message={actionError} />}

      {/* Server Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4 text-[var(--fg-40)]" /> {t("Server Selection")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {profile.servers.length === 0 ? (
            <EmptyState icon={Server} message={t("No servers available. Add servers first.")} />
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
                    disabled={save.isPending}
                    onCheckedChange={(v) => void toggleServer(server.id, v)}
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
                    <span className="font-body text-xs text-[var(--fg-40)]">{t("Enabled")}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Tool Governance */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Wrench className="h-4 w-4 text-[var(--fg-40)]" /> {t("Tool Governance")}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={openCloneForm}
              disabled={clone.isPending || cloneFormOpen}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              {t(clone.isPending ? "Cloning..." : "Clone profile")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {cloneFormOpen && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--fg-08)] bg-surface-100 px-4 py-3">
              <label className="font-body text-xs text-[var(--fg-50)]" htmlFor="clone-profile-name">
                {t("Name for the new profile")}
              </label>
              <Input
                id="clone-profile-name"
                value={cloneName}
                onChange={(event) => setCloneName(event.target.value)}
                className="w-56"
              />
              <Button
                size="sm"
                onClick={() => void submitClone()}
                disabled={clone.isPending || cloneName.trim().length === 0}
              >
                {t(clone.isPending ? "Cloning..." : "Create copy")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCloneFormOpen(false)}
                disabled={clone.isPending}
              >
                {t("Cancel")}
              </Button>
              <span className="font-body text-xs text-[var(--fg-45)]">
                {t("Cloned profiles start inactive.")}
              </span>
            </div>
          )}
          {groupsError && <ErrorBanner message={groupsError} />}
          {groupsLoading ? (
            <p className="font-body text-xs text-[var(--fg-45)]">{t("Loading...")}</p>
          ) : groups.length === 0 ? (
            <EmptyState icon={Wrench} message={t("No discovered tools for this profile yet.")} />
          ) : (
            groups.map((group) => {
              const serverDraft = draft?.[group.serverId];
              return (
                <div
                  key={group.serverId}
                  className="rounded-xl border border-[var(--fg-08)] bg-surface-100 px-4 py-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-headline text-sm text-cursor-dark">
                      {group.serverName}
                    </span>
                    <label className="flex items-center gap-2 font-body text-xs text-[var(--fg-50)]">
                      {t("Server enabled")}
                      <Switch
                        checked={serverDraft?.enabled ?? group.serverEnabled}
                        onCheckedChange={(value) =>
                          setDraft((current) =>
                            current && serverDraft
                              ? { ...current, [group.serverId]: { ...serverDraft, enabled: value } }
                              : current,
                          )
                        }
                      />
                    </label>
                  </div>
                  {group.tools.length === 0 ? (
                    <p className="font-body text-xs text-[var(--fg-40)]">
                      {t("No tools discovered")}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {group.tools.map((tool) => {
                        const disabled =
                          serverDraft?.disabledTools.includes(tool.toolName) ?? tool.disabled;
                        return (
                          <label
                            key={tool.toolName}
                            className="flex items-center gap-2.5 font-body text-xs text-[var(--fg-60)]"
                          >
                            <Checkbox
                              checked={disabled}
                              onCheckedChange={(value) =>
                                setDraft((current) =>
                                  current
                                    ? toggleDraftTool(
                                        current,
                                        group.serverId,
                                        tool.toolName,
                                        value === true,
                                      )
                                    : current,
                                )
                              }
                            />
                            <span className="font-mono">{tool.toolName}</span>
                            <span className="text-[var(--fg-35)]">
                              {disabled ? t("Disabled") : t("Enabled")}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void handleSaveGovernance()}
                disabled={changes.length === 0 || save.isPending}
              >
                {t(save.isPending ? "Saving..." : "Save changes")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setDraft(null)}
                disabled={changes.length === 0 || save.isPending}
              >
                {t("Discard changes")}
              </Button>
              <span className="font-body text-xs text-[var(--fg-45)]">
                {t("{{count}} pending change", { count: String(changes.length) })}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
