import type { ServerStatus } from "./server.js";
import type { ServerHealth } from "./health.js";
import type { Settings } from "./settings.js";

export interface ServerStatusEvent {
  type: "server:status";
  data: {
    serverId: string;
    status: ServerStatus;
    errorMessage?: string | null;
  };
}

export interface ServerHealthEvent {
  type: "server:health";
  data: ServerHealth;
}

export interface ServerToolsEvent {
  type: "server:tools";
  data: {
    serverId: string;
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
  | ServerHealthEvent
  | ServerToolsEvent
  | ProfileActivatedEvent
  | SettingsChangedEvent;

export type MoorEventType = MoorEvent["type"];

export type MoorEventData<T extends MoorEventType> = Extract<MoorEvent, { type: T }>["data"];
