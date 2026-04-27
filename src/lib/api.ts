const getBaseUrl = async (): Promise<string> => {
  try {
    const resp = await fetch("/api/port");
    if (resp.ok) {
      const { port } = await resp.json();
      return `http://127.0.0.1:${port}`;
    }
  } catch {}
  return "http://127.0.0.1:9223";
};

let baseUrl: string | null = null;

export async function getApiUrl(path: string): Promise<string> {
  if (!baseUrl) {
    baseUrl = await getBaseUrl();
  }
  return `${baseUrl}${path}`;
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const url = await getApiUrl(path);
  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
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
