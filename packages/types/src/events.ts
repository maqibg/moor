import type { ServerStatus } from "./server.js";

export interface ServerStatusEvent {
  type: "server:status";
  data: {
    serverId: string;
    status: ServerStatus;
    errorMessage?: string | null;
  };
}

export interface ServerToolsEvent {
  type: "server:tools";
  data: {
    serverId: string;
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  };
}

export interface ProfileActivatedEvent {
  type: "profile:activated";
  data: {
    profileId: string;
  };
}

export type MoorEvent = ServerStatusEvent | ServerToolsEvent | ProfileActivatedEvent;

export type MoorEventType = MoorEvent["type"];
