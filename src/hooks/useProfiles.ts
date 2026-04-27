import { useCallback } from "react";
import { useApi } from "./useApi";
import { apiPost, apiPut, apiDelete } from "@/lib/api";

export function useProfiles() {
  const { data: profiles, loading, error, refresh, setData } = useApi<Profile[]>("/api/profiles", []);

  const createProfile = useCallback(async (name: string) => {
    const profile = await apiPost<Profile>("/api/profiles", { name });
    setData((prev) => [...prev, profile]);
    return profile;
  }, [setData]);

  const activateProfile = useCallback(async (id: string) => {
    await apiPut(`/api/profiles/${id}/activate`, {});
    refresh();
  }, [refresh]);

  const deleteProfile = useCallback(async (id: string) => {
    await apiDelete(`/api/profiles/${id}`);
    setData((prev) => prev.filter((p) => p.id !== id));
  }, [setData]);

  const updateProfile = useCallback(async (id: string, updates: { name?: string }) => {
    await apiPut(`/api/profiles/${id}`, updates);
    refresh();
  }, [refresh]);

  const updateProfileServer = useCallback(async (profileId: string, serverId: string, updates: { enabled?: boolean; disabledTools?: string[] }) => {
    await apiPut(`/api/profiles/${profileId}/servers/${serverId}`, updates);
  }, []);

  return { profiles, loading, error, refresh, createProfile, activateProfile, deleteProfile, updateProfile, updateProfileServer };
}

export interface Profile {
  id: string;
  name: string;
  is_active: number;
  server_count?: number;
  created_at: string;
  updated_at: string;
}
