import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiPost, apiPut, apiDelete } from "@/lib/api";

export function useProfiles() {
  const queryClient = useQueryClient();

  const {
    data: profiles = [],
    isLoading: loading,
    error,
  } = useQuery<Profile[]>({
    queryKey: ["profiles"],
    queryFn: () => api<Profile[]>("/api/profiles"),
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["profiles"] });
  }, [queryClient]);

  const createProfile = useMutation({
    mutationFn: (name: string) => apiPost<Profile>("/api/profiles", { name }),
    onSuccess: (profile) => {
      queryClient.setQueryData<Profile[]>(["profiles"], (prev) => [...(prev ?? []), profile]);
    },
  });

  const activateProfile = useCallback(
    async (id: string) => {
      await apiPut(`/api/profiles/${id}/activate`, {});
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
    [queryClient],
  );

  const deleteProfile = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/profiles/${id}`).then(() => id),
    onSuccess: (id) => {
      queryClient.setQueryData<Profile[]>(["profiles"], (prev) => prev?.filter((p) => p.id !== id));
    },
  });

  const updateProfile = useCallback(
    async (id: string, updates: { name?: string }) => {
      await apiPut(`/api/profiles/${id}`, updates);
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
      await apiPut(`/api/profiles/${profileId}/servers/${serverId}`, updates);
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

export interface Profile {
  id: string;
  name: string;
  is_active: boolean;
  server_count?: number;
  created_at: string;
  updated_at: string;
}
