import type { ProfileServerUpsertInput, ProfileToolGroup } from "@moor/types";

/** 治理面板的本地草稿：按 serverId 记录启用态与该 profile 下被禁用的工具名。 */
export type GovernanceDraft = Record<string, { enabled: boolean; disabledTools: string[] }>;

export function buildGovernanceDraft(groups: ProfileToolGroup[]): GovernanceDraft {
  const draft: GovernanceDraft = {};
  for (const group of groups) {
    draft[group.serverId] = {
      enabled: group.serverEnabled,
      disabledTools: group.tools.filter((tool) => tool.disabled).map((tool) => tool.toolName),
    };
  }
  return draft;
}

export function toggleDraftTool(
  draft: GovernanceDraft,
  serverId: string,
  toolName: string,
  disabled: boolean,
): GovernanceDraft {
  const current = draft[serverId];
  if (!current) return draft;
  const next = disabled
    ? Array.from(new Set([...current.disabledTools, toolName]))
    : current.disabledTools.filter((name) => name !== toolName);
  return { ...draft, [serverId]: { ...current, disabledTools: next } };
}

function sameToolSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((name, index) => name === sortedRight[index]);
}

/**
 * 只提交真正变化的字段：后端把 enabled 与 disabledTools 当作互相独立的可选补丁，
 * 省略未变的一方可以避免覆盖并发的其他修改。
 */
export function diffGovernanceDraft(
  groups: ProfileToolGroup[],
  draft: GovernanceDraft,
): ProfileServerUpsertInput[] {
  const updates: ProfileServerUpsertInput[] = [];
  for (const group of groups) {
    const next = draft[group.serverId];
    if (!next) continue;
    const originalTools = group.tools.filter((tool) => tool.disabled).map((tool) => tool.toolName);
    const update: ProfileServerUpsertInput = { serverId: group.serverId };
    if (next.enabled !== group.serverEnabled) {
      update.enabled = next.enabled;
    }
    if (!sameToolSet(originalTools, next.disabledTools)) {
      update.disabledTools = [...next.disabledTools].sort();
    }
    if (update.enabled !== undefined || update.disabledTools !== undefined) {
      updates.push(update);
    }
  }
  return updates;
}

export function countDisabledTools(groups: ProfileToolGroup[]): number {
  return groups.reduce(
    (total, group) => total + group.tools.filter((tool) => tool.disabled).length,
    0,
  );
}

/**
 * 草稿只覆盖「已发现工具」这些可见行，而 profile 的 disabledTools 里可能还留着已从发现列表
 * 消失的工具名（例如服务器改版后该工具不存在了）。后端把 disabledTools 当整表补丁处理，
 * 所以提交前必须把看不见的禁用名并回来，否则会静默丢掉这些禁用态。
 */
export function mergeHiddenDisabledTools(
  updates: ProfileServerUpsertInput[],
  groups: ProfileToolGroup[],
  authoritativeDisabledTools: Record<string, string[] | undefined>,
): ProfileServerUpsertInput[] {
  return updates.map((update) => {
    if (update.disabledTools === undefined) return update;
    const visible = new Set(
      (groups.find((group) => group.serverId === update.serverId)?.tools ?? []).map(
        (tool) => tool.toolName,
      ),
    );
    const hidden = (authoritativeDisabledTools[update.serverId] ?? []).filter(
      (name) => !visible.has(name),
    );
    if (hidden.length === 0) return update;
    return {
      ...update,
      disabledTools: Array.from(new Set([...update.disabledTools, ...hidden])).sort(),
    };
  });
}
