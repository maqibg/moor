function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

export const routes = {
  servers: {
    list: () => "/api/servers",
    detail: (id: string) => `/api/servers/${pathSegment(id)}`,
    create: () => "/api/servers",
    update: (id: string) => `/api/servers/${pathSegment(id)}`,
    delete: (id: string) => `/api/servers/${pathSegment(id)}`,
    start: (id: string) => `/api/servers/${pathSegment(id)}/start`,
    stop: (id: string) => `/api/servers/${pathSegment(id)}/stop`,
    order: () => "/api/servers/order",
    tools: (id: string, profileId?: string) =>
      withQuery(`/api/servers/${pathSegment(id)}/tools`, { profile_id: profileId }),
  },
  profiles: {
    list: () => "/api/profiles",
    detail: (id: string) => `/api/profiles/${pathSegment(id)}`,
    create: () => "/api/profiles",
    update: (id: string) => `/api/profiles/${pathSegment(id)}`,
    delete: (id: string) => `/api/profiles/${pathSegment(id)}`,
    activate: (id: string) => `/api/profiles/${pathSegment(id)}/activate`,
    updateServer: (profileId: string, serverId: string) =>
      `/api/profiles/${pathSegment(profileId)}/servers/${pathSegment(serverId)}`,
  },
  settings: {
    get: () => "/api/settings",
    update: () => "/api/settings",
    reset: () => "/api/settings/reset",
  },
  logs: {
    list: (qs?: string) => `/api/logs${qs ? `?${qs}` : ""}`,
    stats: () => "/api/logs/stats",
  },
  import: {
    scan: () => "/api/import/scan",
    parse: () => "/api/import/parse",
    execute: () => "/api/import/execute",
    snippets: () => "/api/import/snippets",
    convert: () => "/api/import/convert",
  },
  events: () => "/api/events",
  runtime: () => "/api/runtime",
  health: () => "/api/health",
} as const;
