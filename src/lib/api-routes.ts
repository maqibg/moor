export const routes = {
  servers: {
    list: () => "/api/servers",
    detail: (id: string) => `/api/servers/${id}`,
    create: () => "/api/servers",
    update: (id: string) => `/api/servers/${id}`,
    delete: (id: string) => `/api/servers/${id}`,
    start: (id: string) => `/api/servers/${id}/start`,
    stop: (id: string) => `/api/servers/${id}/stop`,
    order: () => "/api/servers/order",
    tools: (id: string, profileId?: string) =>
      `/api/servers/${id}/tools${profileId ? `?profile_id=${profileId}` : ""}`,
  },
  profiles: {
    list: () => "/api/profiles",
    detail: (id: string) => `/api/profiles/${id}`,
    create: () => "/api/profiles",
    update: (id: string) => `/api/profiles/${id}`,
    delete: (id: string) => `/api/profiles/${id}`,
    activate: (id: string) => `/api/profiles/${id}/activate`,
    updateServer: (profileId: string, serverId: string) =>
      `/api/profiles/${profileId}/servers/${serverId}`,
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
