import { getSidecarInfo } from "@/lib/tauri";
import type { SidecarInfo } from "@moor/types";

const defaultRuntime = (): SidecarInfo => ({
  port: 9223,
  baseUrl: import.meta.env.VITE_MOOR_API_URL ?? "http://127.0.0.1:9223",
  apiToken: import.meta.env.VITE_MOOR_API_TOKEN ?? "dev-token",
});

async function getRuntimeInfo(): Promise<SidecarInfo> {
  try {
    return await getSidecarInfo();
  } catch {
    // Fall through to HTTP discovery
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
}

let runtimeInfo: SidecarInfo | null = null;
let runtimeInfoPromise: Promise<SidecarInfo> | null = null;

export function resetRuntime(): void {
  runtimeInfo = null;
  runtimeInfoPromise = null;
}

export async function getApiRuntime(): Promise<SidecarInfo> {
  if (runtimeInfo) {
    return runtimeInfo;
  }
  if (!runtimeInfoPromise) {
    runtimeInfoPromise = getRuntimeInfo()
      .then((info) => {
        runtimeInfo = info;
        return info;
      })
      .finally(() => {
        runtimeInfoPromise = null;
      });
  }
  return runtimeInfoPromise;
}

export async function refreshApiRuntime(): Promise<SidecarInfo> {
  resetRuntime();
  return getApiRuntime();
}

export function buildApiUrl(runtime: SidecarInfo, path: string): string {
  return `${runtime.baseUrl}${path}`;
}

export function buildApiHeaders(runtime: SidecarInfo, extra?: HeadersInit): HeadersInit {
  const extraHeaders = new Headers(extra);
  const headers: Record<string, string> = {};
  if (!extraHeaders.has("Content-Type")) {
    headers["Content-Type"] = "application/json";
  }
  extraHeaders.forEach((value, key) => {
    headers[key] = value;
  });
  headers["X-Moor-Token"] = runtime.apiToken;
  return headers;
}
