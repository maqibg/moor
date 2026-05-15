export { getApiRuntime, resetRuntime } from "./api/runtime";
export { formatApiNetworkError } from "./api/errors";
export { api, apiPost, apiPut, apiDelete } from "./api/client";
export type { RequestOptions } from "./api/client";

import { getApiRuntime, buildApiUrl } from "./api/runtime";
import { buildApiHeaders } from "./api/runtime";

export async function getApiUrl(path: string): Promise<string> {
  const runtime = await getApiRuntime();
  return buildApiUrl(runtime, path);
}

export async function getMcpEndpoint(): Promise<string> {
  const runtime = await getApiRuntime();
  return `${runtime.baseUrl}/mcp`;
}

export async function getApiHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  const runtime = await getApiRuntime();
  return buildApiHeaders(runtime, extra);
}

export async function getApiRequest(
  path: string,
  extraHeaders?: HeadersInit,
): Promise<{ url: string; headers: HeadersInit; runtime: import("@moor/types").SidecarInfo }> {
  const runtime = await getApiRuntime();
  return {
    url: buildApiUrl(runtime, path),
    headers: buildApiHeaders(runtime, extraHeaders),
    runtime,
  };
}
