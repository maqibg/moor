import { invoke } from "@tauri-apps/api/core";

interface SidecarInfo {
  port: number;
  baseUrl: string;
  apiToken: string;
}

const defaultRuntime = (): SidecarInfo => ({
  port: 9223,
  baseUrl: import.meta.env.VITE_MOOR_API_URL ?? "http://127.0.0.1:9223",
  apiToken: import.meta.env.VITE_MOOR_API_TOKEN ?? "dev-token",
});

const getRuntimeInfo = async (): Promise<SidecarInfo> => {
  try {
    return await invoke<SidecarInfo>("get_sidecar_info");
  } catch {
    // Browser dev mode does not have Tauri commands.
  }

  const fallback = defaultRuntime();
  try {
    const resp = await fetch(`${fallback.baseUrl}/api/runtime`, {
      headers: { "X-Moor-Token": fallback.apiToken },
    });
    if (resp.ok) {
      const runtime = (await resp.json()) as { port: number; baseUrl: string };
      return { ...fallback, port: runtime.port, baseUrl: runtime.baseUrl };
    }
  } catch {
    // Dev sidecar may not be running yet; callers will surface API errors.
  }
  return fallback;
};

let runtimeInfo: SidecarInfo | null = null;

export async function getApiRuntime(): Promise<SidecarInfo> {
  if (!runtimeInfo) {
    runtimeInfo = await getRuntimeInfo();
  }
  return runtimeInfo;
}

export async function getApiUrl(path: string): Promise<string> {
  const runtime = await getApiRuntime();
  return `${runtime.baseUrl}${path}`;
}

export async function getApiHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  const runtime = await getApiRuntime();
  return {
    "Content-Type": "application/json",
    "X-Moor-Token": runtime.apiToken,
    ...extra,
  };
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const url = await getApiUrl(path);
  const resp = await fetch(url, {
    ...options,
    headers: await getApiHeaders(options?.headers),
  });
  if (!resp.ok) {
    const error = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(error.error || `API error: ${resp.status}`);
  }
  return resp.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return api<T>(path, { method: "DELETE" });
}
