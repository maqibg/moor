import { invoke } from "@tauri-apps/api/core";
import type { SidecarInfo } from "@moor/types";
import { isRecord, createErrorWithCause } from "@/lib/utils";

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

async function refreshApiRuntime(): Promise<SidecarInfo> {
  resetRuntime();
  return getApiRuntime();
}

function getApiUrlForRuntime(runtime: SidecarInfo, path: string): string {
  return `${runtime.baseUrl}${path}`;
}

function getApiHeadersForRuntime(runtime: SidecarInfo, extra?: HeadersInit): HeadersInit {
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

export async function getApiUrl(path: string): Promise<string> {
  const runtime = await getApiRuntime();
  return getApiUrlForRuntime(runtime, path);
}

export async function getMcpEndpoint(): Promise<string> {
  const runtime = await getApiRuntime();
  return `${runtime.baseUrl}/mcp`;
}

export async function getApiHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  const runtime = await getApiRuntime();
  return getApiHeadersForRuntime(runtime, extra);
}

export async function getApiRequest(
  path: string,
  extraHeaders?: HeadersInit,
): Promise<{ url: string; headers: HeadersInit; runtime: SidecarInfo }> {
  const runtime = await getApiRuntime();
  return {
    url: getApiUrlForRuntime(runtime, path),
    headers: getApiHeadersForRuntime(runtime, extraHeaders),
    runtime,
  };
}

export function formatApiNetworkError(path: string, err: unknown, runtime?: SidecarInfo): string {
  const detail = err instanceof Error ? err.message : String(err);
  const target = runtime ? ` at ${runtime.baseUrl}` : "";
  return `Unable to connect to the Moor sidecar while requesting ${path}${target}. Check that Moor is running and the Sidecar API port/token are current. Original error: ${detail}`;
}

function formatApiRetryError(
  path: string,
  runtime: SidecarInfo,
  original: unknown,
  retryFailure: unknown,
): string {
  const originalDetail = original instanceof Error ? original.message : String(original);
  const retryDetail = retryFailure instanceof Error ? retryFailure.message : String(retryFailure);
  return `Unable to connect to the Moor sidecar while requesting ${path} at ${runtime.baseUrl} after refreshing runtime. Original error: ${originalDetail}. Retry error: ${retryDetail}`;
}

async function readApiError(resp: Response): Promise<string> {
  const parsed = (await resp.json().catch(() => null)) as unknown;
  if (isRecord(parsed)) {
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
    if (isRecord(parsed.error)) {
      if (typeof parsed.error.message === "string" && parsed.error.message.length > 0) {
        return parsed.error.message;
      }
      if (typeof parsed.error.code === "string" && parsed.error.code.length > 0) {
        return parsed.error.code;
      }
    }
  }
  return resp.statusText || `API error: ${resp.status}`;
}

async function parseApiResponse<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    throw new Error(await readApiError(resp));
  }
  return resp.json() as Promise<T>;
}

export interface RequestOptions extends RequestInit {
  signal?: AbortSignal;
}

async function fetchWithRuntime(
  path: string,
  options: RequestOptions | undefined,
  runtime: SidecarInfo,
): Promise<Response> {
  return fetch(getApiUrlForRuntime(runtime, path), {
    ...options,
    headers: getApiHeadersForRuntime(runtime, options?.headers),
    signal: options?.signal,
  });
}

async function retryWithFreshRuntime<T>(
  path: string,
  options: RequestOptions | undefined,
  originalError: unknown,
): Promise<T> {
  const runtime = await refreshApiRuntime();
  try {
    const retryResp = await fetchWithRuntime(path, options, runtime);
    if (!retryResp.ok) {
      throw new Error(await readApiError(retryResp));
    }
    return retryResp.json() as Promise<T>;
  } catch (retryErr) {
    throw createErrorWithCause(
      formatApiRetryError(path, runtime, originalError, retryErr),
      originalError,
    );
  }
}

function shouldRetryNetworkError(options?: RequestOptions): boolean {
  const method = options?.method?.toUpperCase() ?? "GET";
  return method === "GET" || method === "HEAD";
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (isRecord(err) && err.name === "AbortError");
}

export async function api<T>(path: string, options?: RequestOptions): Promise<T> {
  const runtime = await getApiRuntime();
  let resp: Response;
  try {
    resp = await fetchWithRuntime(path, options, runtime);
  } catch (err) {
    if (isAbortError(err, options?.signal)) {
      throw err;
    }
    const networkError = createErrorWithCause(formatApiNetworkError(path, err, runtime), err);
    if (!shouldRetryNetworkError(options)) {
      throw networkError;
    }
    return retryWithFreshRuntime<T>(path, options, networkError);
  }
  if (resp.status === 401) {
    return retryWithFreshRuntime<T>(path, options, new Error(await readApiError(resp)));
  }
  return parseApiResponse<T>(resp);
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
