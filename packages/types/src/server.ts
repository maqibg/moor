export type ConnectionType = "stdio" | "http";
export type ServerStatus = "stopped" | "starting" | "running" | "error";
export type ServerAction = "starting" | "stopping";

export interface ServerBase {
  id: string;
  name: string;
  connection_type: ConnectionType;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  env?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  working_dir?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}
