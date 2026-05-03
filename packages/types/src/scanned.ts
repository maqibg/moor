import type { ConnectionType } from "./server.js";

export interface ScannedServer {
  name: string;
  connectionType: ConnectionType;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  workingDir?: string;
  source: string;
}

export interface UnsupportedServer {
  name: string;
  source: string;
  reason: string;
}

export interface ImportDiagnostic {
  source: string;
  message: string;
  code?: string;
  line?: number;
  column?: number;
  offset?: number;
  length?: number;
}

export interface ParsedImport {
  servers: ScannedServer[];
  unsupported: UnsupportedServer[];
  errors: string[];
  diagnostics: ImportDiagnostic[];
}

export interface ImportPreview {
  scanned: number;
  newServers: number;
  servers: ScannedServer[];
  duplicates: ScannedServer[];
  unsupported: UnsupportedServer[];
  errors: string[];
  diagnostics?: ImportDiagnostic[];
}
