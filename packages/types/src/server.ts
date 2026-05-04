export type ConnectionType = "stdio" | "http";
export type ServerStatus = "stopped" | "starting" | "running" | "error";
export type ServerAction = "starting" | "stopping";

export interface ServerBase {
  id: string;
  name: string;
  connectionType: ConnectionType;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  env?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  workingDir?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}
