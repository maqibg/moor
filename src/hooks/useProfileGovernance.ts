import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Profile, ProfileServerUpsertInput, ProfileToolGroup } from "@moor/types";
import { api, apiPost, apiPut } from "@/lib/api/client";
import { routes } from "@/lib/api-routes";
import { logKeys, profileKeys, serverKeys } from "@/lib/query-keys";

/** Profile 工具治理：分组工具矩阵 + 批量服务器状态写入 + 克隆。 */
export function useProfileGovernance(profileId: string | undefined) {
  const queryClient = useQueryClient();

  const groupsQuery = useQuery<ProfileToolGroup[]>({
    queryKey: profileKeys.governance(profileId ?? ""),
    queryFn: ({ signal }) =>
      api<ProfileToolGroup[]>(routes.profiles.tools(profileId as string), { signal }),
    enabled: Boolean(profileId),
  });

  // 返回 Promise 并交给 onSuccess 等待：写完后缓存已是服务端真值，
  // 页面可以在 mutateAsync 之后安全地重建草稿（否则会用旧快照重建）。
  const invalidate = () => {
    if (!profileId) return Promise.resolve();
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: profileKeys.governance(profileId) }),
      queryClient.invalidateQueries({ queryKey: profileKeys.detail(profileId) }),
      queryClient.invalidateQueries({ queryKey: profileKeys.list() }),
      queryClient.invalidateQueries({ queryKey: serverKeys.list() }),
      queryClient.invalidateQueries({ queryKey: logKeys.all() }),
    ]);
  };

  const save = useMutation({
    mutationFn: (updates: ProfileServerUpsertInput[]) =>
      apiPut<{ success: boolean; updated: number }>(
        routes.profiles.bulkServersState(profileId as string),
        { updates },
      ),
    onSuccess: () => invalidate(),
  });

  const clone = useMutation({
    mutationFn: (name: string) =>
      apiPost<Profile>(routes.profiles.clone(profileId as string), { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.list() });
    },
  });

  return {
    groups: groupsQuery.data ?? [],
    loading: groupsQuery.isLoading,
    error: groupsQuery.error ? (groupsQuery.error as Error).message : null,
    save,
    clone,
  };
}
