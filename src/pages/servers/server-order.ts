import type { Server } from "@moor/types";

export function getServerIds(servers: Server[]): string[] {
  return servers.map((server) => server.id);
}

export function getReorderedServers(
  servers: Server[],
  activeId: string,
  overId: string | null | undefined,
): Server[] {
  if (!overId || activeId === overId) return servers;
  const oldIndex = servers.findIndex((server) => server.id === activeId);
  const newIndex = servers.findIndex((server) => server.id === overId);
  if (oldIndex < 0 || newIndex < 0) return servers;

  const next = [...servers];
  const [moved] = next.splice(oldIndex, 1);
  if (!moved) return servers;
  next.splice(newIndex, 0, moved);
  return next;
}
