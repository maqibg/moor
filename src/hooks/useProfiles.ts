import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiPost, apiPut, apiDelete } from "@/lib/api/client";
import { routes } from "@/lib/api-routes";
import { serverKeys, profileKeys, logKeys } from "@/lib/query-keys";
import { useSSEEvent } from "@/contexts/SSEContext";
import type { Profile, ProfileDetail, ProfileServerUpsert, ProfileToolGroup } from "@moor/types";

export function useProfiles() {
  const queryClient = useQueryClient();

  useSSEEvent("profile:activated", () => {
    void queryClient.invalidateQueries({ queryKey: profileKeys.list() });
    void queryClient.invalidateQueries({ queryKey: serverKeys.list() });
    void queryClient.invalidateQueries({ queryKey: logKeys.all() });
  });

  const {
    data: profiles = [],
    isLoading: loading,
    error,
  } = useQuery<Profile[]>({
    queryKey: profileKeys.list(),
    queryFn: ({ signal }) => api<Profile[]>(routes.profiles.list(), { signal }),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: profileKeys.list() });
  }, [queryClient]);

  const createProfile = useMutation({
    mutationFn: (name: string) => apiPost<Profile>(routes.profiles.create(), { name }),
    onSuccess: (profile) => {
      queryClient.setQueryData<Profile[]>(profileKeys.list(), (prev) => [...(prev ?? []), profile]);
    },
  });

  const activateProfile = useMutation({
    mutationFn: async (id: string) => {
      await apiPut(routes.profiles.activate(id), {});
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.list() });
      void queryClient.invalidateQueries({ queryKey: serverKeys.list() });
    },
  });

  const deleteProfile = useMutation({
    mutationFn: (id: string) => apiDelete(routes.profiles.delete(id)).then(() => id),
    onSuccess: (id) => {
      queryClient.setQueryData<Profile[]>(profileKeys.list(), (prev) =>
        prev?.filter((p) => p.id !== id),
      );
    },
  });

  const updateProfile = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: { name?: string } }) => {
      await apiPut(routes.profiles.update(id), updates);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.list() });
    },
  });

  const updateProfileServer = useMutation({
    mutationFn: async ({
      profileId,
      serverId,
      updates,
    }: {
      profileId: string;
      serverId: string;
      updates: { enabled?: boolean; disabledTools?: string[] };
    }) => {
      await apiPut(routes.profiles.updateServer(profileId, serverId), updates);
    },
    onSuccess: (_data, { profileId, serverId }) => {
      // disabled_tools 变化影响各 profile 变体的 tools 查询，失效归 hook 负责
      void queryClient.invalidateQueries({ queryKey: profileKeys.detail(profileId) });
      void queryClient.invalidateQueries({ queryKey: profileKeys.tools(profileId) });
      void queryClient.invalidateQueries({ queryKey: serverKeys.toolsRoot(serverId) });
    },
  });

  const updateProfileServers = useMutation({
    mutationFn: async ({
      profileId,
      updates,
    }: {
      profileId: string;
      updates: ProfileServerUpsert[];
    }) => {
      await apiPut(routes.profiles.bulkServerState(profileId), { updates });
    },
    onSuccess: (_data, { profileId, updates }) => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.detail(profileId) });
      void queryClient.invalidateQueries({ queryKey: profileKeys.tools(profileId) });
      for (const update of updates) {
        void queryClient.invalidateQueries({ queryKey: serverKeys.toolsRoot(update.serverId) });
      }
    },
  });

  const cloneProfile = useMutation({
    mutationFn: async ({ sourceId, name }: { sourceId: string; name: string }) =>
      apiPost<Profile>(routes.profiles.clone(sourceId), { name }),
    onSuccess: (profile) => {
      queryClient.setQueryData<Profile[]>(profileKeys.list(), (prev) => [...(prev ?? []), profile]);
    },
  });

  return {
    profiles,
    loading,
    error: error?.message ?? null,
    refresh,
    createProfile: createProfile.mutateAsync,
    activateProfile: activateProfile.mutateAsync,
    deleteProfile: deleteProfile.mutateAsync,
    updateProfile: updateProfile.mutateAsync,
    updateProfileServer: updateProfileServer.mutateAsync,
    updateProfileServers: updateProfileServers.mutateAsync,
    cloneProfile: cloneProfile.mutateAsync,
    // 批量接口是快照覆盖语义，进行中禁用控件以防并发写互相覆盖
    isUpdatingServer: updateProfileServer.isPending,
    isUpdatingServers: updateProfileServers.isPending,
  };
}

export function useProfile(id: string | undefined) {
  const queryClient = useQueryClient();

  const {
    data: profile,
    isLoading,
    error,
  } = useQuery<ProfileDetail | null>({
    queryKey: profileKeys.detail(id!),
    queryFn: ({ signal }) => api<ProfileDetail | null>(routes.profiles.detail(id!), { signal }),
    enabled: !!id,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: profileKeys.detail(id!) });
  }, [queryClient, id]);

  return { profile, isLoading, error, refresh };
}

export function useProfileTools(id: string | undefined) {
  const queryClient = useQueryClient();

  const {
    data: groups = [],
    isLoading,
    error,
  } = useQuery<ProfileToolGroup[]>({
    queryKey: profileKeys.tools(id!),
    queryFn: ({ signal }) => api<ProfileToolGroup[]>(routes.profiles.tools(id!), { signal }),
    enabled: !!id,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: profileKeys.tools(id!) });
  }, [queryClient, id]);

  return { groups, isLoading, error, refresh };
}
