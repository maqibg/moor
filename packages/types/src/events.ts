import type { ServerStatus } from "./server.js";
import type { Settings } from "./settings.js";

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

export interface SettingsChangedEvent {
  type: "settings:changed";
  data: Settings;
}

export type MoorEvent =
  | ServerStatusEvent
  | ServerToolsEvent
  | ProfileActivatedEvent
  | SettingsChangedEvent;

export type MoorEventType = MoorEvent["type"];
