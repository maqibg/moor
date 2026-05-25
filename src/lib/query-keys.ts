export const serverKeys = {
  list: () => ["servers"] as const,
  detail: (id: string) => ["servers", id] as const,
  toolsRoot: (serverId: string) => ["servers", serverId, "tools"] as const,
  tools: (serverId: string, profileId?: string) =>
    ["servers", serverId, "tools", profileId] as const,
};

export const profileKeys = {
  list: () => ["profiles"] as const,
  detail: (id: string) => ["profiles", id] as const,
};

export const settingKeys = {
  all: () => ["settings"] as const,
};

export const logKeys = {
  all: () => ["logs"] as const,
  list: (filters?: { server_id?: string; tool_name?: string; from?: string; to?: string }) =>
    ["logs", filters] as const,
  stats: () => ["logs", "stats"] as const,
};
