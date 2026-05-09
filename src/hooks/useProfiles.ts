import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiPost, apiPut, apiDelete } from "@/lib/api";
import { routes } from "@/lib/api-routes";
import { useSSEEvent } from "@/contexts/SSEContext";
import type { Profile, ProfileDetail } from "@moor/types";

export function useProfiles() {
  const queryClient = useQueryClient();

  useSSEEvent("profile:activated", () => {
    void queryClient.invalidateQueries({ queryKey: ["profiles"] });
    void queryClient.invalidateQueries({ queryKey: ["servers"] });
    void queryClient.invalidateQueries({ queryKey: ["logs"] });
  });

  const {
    data: profiles = [],
    isLoading: loading,
    error,
  } = useQuery<Profile[]>({
    queryKey: ["profiles"],
    queryFn: () => api<Profile[]>(routes.profiles.list()),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["profiles"] });
  }, [queryClient]);

  const createProfile = useMutation({
    mutationFn: (name: string) => apiPost<Profile>(routes.profiles.create(), { name }),
    onSuccess: (profile) => {
      queryClient.setQueryData<Profile[]>(["profiles"], (prev) => [...(prev ?? []), profile]);
    },
  });

  const activateProfile = useCallback(
    async (id: string) => {
      await apiPut(routes.profiles.activate(id), {});
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
    [queryClient],
  );

  const deleteProfile = useMutation({
    mutationFn: (id: string) => apiDelete(routes.profiles.delete(id)).then(() => id),
    onSuccess: (id) => {
      queryClient.setQueryData<Profile[]>(["profiles"], (prev) => prev?.filter((p) => p.id !== id));
    },
  });

  const updateProfile = useCallback(
    async (id: string, updates: { name?: string }) => {
      await apiPut(routes.profiles.update(id), updates);
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    [queryClient],
  );

  const updateProfileServer = useCallback(
    async (
      profileId: string,
      serverId: string,
      updates: { enabled?: boolean; disabledTools?: string[] },
    ) => {
      await apiPut(routes.profiles.updateServer(profileId, serverId), updates);
    },
    [],
  );

  return {
    profiles,
    loading,
    error: error?.message ?? null,
    refresh,
    createProfile: createProfile.mutateAsync,
    activateProfile,
    deleteProfile: deleteProfile.mutateAsync,
    updateProfile,
    updateProfileServer,
  };
}

export function useProfile(id: string | undefined) {
  const queryClient = useQueryClient();

  const {
    data: profile,
    isLoading,
    error,
  } = useQuery<ProfileDetail | null>({
    queryKey: ["profiles", id],
    queryFn: () => api<ProfileDetail | null>(routes.profiles.detail(id!)),
    enabled: !!id,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["profiles", id] });
  }, [queryClient, id]);

  return { profile, isLoading, error, refresh };
}
