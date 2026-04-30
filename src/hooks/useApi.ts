import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface RefreshOptions {
  silent?: boolean;
}

export function useApi<T>(path: string, defaultValue: T) {
  const [data, setData] = useState<T>(defaultValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (options?: RefreshOptions) => {
      try {
        if (!options?.silent) setLoading(true);
        setError(null);
        const result = await api<T>(path);
        setData(result);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh, setData };
}
