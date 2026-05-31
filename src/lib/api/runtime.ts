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
    // Outside Tauri (e.g. `pnpm dev` in a plain browser) there is no in-process
    // gateway. Point at one via VITE_MOOR_API_URL / VITE_MOOR_API_TOKEN; otherwise
    // API calls surface errors. The desktop dev loop is `pnpm tauri dev`.
    return defaultRuntime();
  }
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
