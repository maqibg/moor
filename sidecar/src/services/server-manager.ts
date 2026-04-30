import { EventEmitter } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { run, queryAll, queryOne, saveDb, transaction } from "../db/index.js";
import { serializeToolDiscovery } from "../db/serializers.js";
import {
  buildToolCatalogFromRows,
  type ToolCatalogEntry,
  type ToolCatalogRow,
} from "../mcp/tool-catalog.js";
import { eventBus } from "./event-bus.js";

declare const APP_VERSION: string;

export interface ManagedServer {
  id: string;
  name: string;
  connectionType: "stdio" | "http";
  status: "stopped" | "starting" | "running" | "error";
}

interface ServerSession {
  client: Client;
  transport: Transport;
}

interface StoredServerConfig {
  id: string;
  name: string;
  connection_type: "stdio" | "http";
  command: string | null;
  args: string[] | null;
  url: string | null;
  env: Record<string, string> | null;
  headers: Record<string, string> | null;
  working_dir: string | null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function getAppVersion(): string {
  return typeof APP_VERSION === "undefined" ? "0.0.0-dev" : APP_VERSION;
}

function resolveHeaderValue(value: string): string | null {
  let missingEnv = false;
  const resolved = value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const envValue = process.env[name];
    if (envValue == null) {
      missingEnv = true;
      return "";
    }
    return envValue;
  });
  return missingEnv ? null : resolved;
}

export function resolveHttpHeaders(
  headers: Record<string, string> | null,
): HeadersInit | undefined {
  if (!headers) return undefined;
  const resolved = Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [key, resolveHeaderValue(value)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] != null),
  );
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

class ServerManager extends EventEmitter {
  private servers: Map<string, ManagedServer> = new Map();
  private sessions: Map<string, ServerSession> = new Map();

  loadFromDb() {
    this.servers.clear();
    const rows = queryAll("SELECT * FROM mcp_servers", []);
    for (const row of rows) {
      this.servers.set(row.id as string, {
        id: row.id as string,
        name: row.name as string,
        connectionType: row.connection_type as "stdio" | "http",
        status: row.status as ManagedServer["status"],
      });
    }
  }

  resetForTest() {
    this.servers.clear();
    this.sessions.clear();
  }

  getServer(id: string): ManagedServer | undefined {
    return this.servers.get(id);
  }

  listServers(): ManagedServer[] {
    return Array.from(this.servers.values());
  }

  addServer(config: {
    name: string;
    connectionType: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    workingDir?: string;
  }): ManagedServer {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    run(
      `INSERT INTO mcp_servers (id, name, connection_type, command, args, url, env, headers, working_dir, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'stopped', ?, ?)`,
      [
        id,
        config.name,
        config.connectionType,
        config.command ?? null,
        config.args ? JSON.stringify(config.args) : null,
        config.url ?? null,
        config.env ? JSON.stringify(config.env) : null,
        config.headers ? JSON.stringify(config.headers) : null,
        config.workingDir ?? null,
        now,
        now,
      ],
    );
    saveDb();

    const server: ManagedServer = {
      id,
      name: config.name,
      connectionType: config.connectionType,
      status: "stopped",
    };
    this.servers.set(id, server);
    return server;
  }

  updateServer(id: string, updates: Record<string, unknown>): ManagedServer | null {
    const server = this.servers.get(id);
    if (!server) return null;

    const allowedFields: Record<string, string> = {
      name: "name",
      command: "command",
      args: "args",
      url: "url",
      env: "env",
      headers: "headers",
      workingDir: "working_dir",
      working_dir: "working_dir",
    };
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [field, col] of Object.entries(allowedFields)) {
      if (field in updates) {
        setClauses.push(`${col} = ?`);
        const val = updates[field];
        values.push(typeof val === "object" && val !== null ? JSON.stringify(val) : val);
      }
    }

    if (setClauses.length === 0) return server;
    setClauses.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);

    run(`UPDATE mcp_servers SET ${setClauses.join(", ")} WHERE id = ?`, values);
    saveDb();
    if (updates.name) server.name = updates.name as string;
    return server;
  }

  async removeServer(id: string): Promise<boolean> {
    const server = this.servers.get(id);
    if (!server) return false;
    if (server.status === "running") await this.stopServer(id);
    run("DELETE FROM mcp_servers WHERE id = ?", [id]);
    saveDb();
    this.servers.delete(id);
    return true;
  }

  async startServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) throw new Error(`Server ${id} not found`);
    if (server.status === "running") return;

    this.setServerStatus(id, "starting");
    try {
      const config = this.getStoredServerConfig(id);
      const session = await this.createSession(config);
      this.sessions.set(id, session);

      const toolsResult = await session.client.listTools();
      this.cacheTools(
        id,
        toolsResult.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      );

      this.setServerStatus(id, "running");
    } catch (err) {
      this.sessions.delete(id);
      this.setServerStatus(id, "error", (err as Error).message);
      throw err;
    }
  }

  async stopServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server || server.status !== "running") return;
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    if (session) await session.client.close().catch(() => undefined);
    this.setServerStatus(id, "stopped");
  }

  async stopAll() {
    await Promise.all(Array.from(this.servers.keys()).map((id) => this.stopServer(id)));
  }

  async callToolByExposedName(exposedName: string, args: unknown): Promise<unknown> {
    const owner = this.findToolOwner(exposedName);
    if (!owner) throw new Error(`Tool "${exposedName}" not found or disabled`);

    const session = this.sessions.get(owner.serverId);
    if (!session) throw new Error(`Server "${owner.serverName}" is not running`);
    return session.client.callTool({
      name: owner.toolName,
      arguments: args as Record<string, unknown>,
    });
  }

  findToolOwner(exposedName: string): ToolCatalogEntry | null {
    return this.getToolCatalog().find((tool) => tool.exposedName === exposedName) ?? null;
  }

  getToolCatalog(profileId?: string | null): ToolCatalogEntry[] {
    const activeProfileId =
      profileId ??
      (queryOne("SELECT id FROM profiles WHERE is_active = 1", [])?.id as string | undefined);
    if (!activeProfileId) return [];

    const rows = queryAll(
      `
      SELECT
        ps.server_id AS serverId,
        ms.name AS serverName,
        ps.disabled_tools AS disabledTools,
        td.tool_name AS toolName,
        td.description AS description,
        td.input_schema AS inputSchema
      FROM profile_servers ps
      JOIN mcp_servers ms ON ps.server_id = ms.id
      JOIN tool_discoveries td ON td.server_id = ms.id
      WHERE ps.profile_id = ? AND ps.enabled = 1
      ORDER BY ms.name ASC, td.tool_name ASC
    `,
      [activeProfileId],
    );

    return buildToolCatalogFromRows(
      rows.map(
        (row) =>
          ({
            serverId: row.serverId as string,
            serverName: row.serverName as string,
            disabledTools: parseJson<string[]>(row.disabledTools, []),
            toolName: row.toolName as string,
            description: row.description as string | null,
            inputSchema: parseJson(row.inputSchema, undefined),
          }) satisfies ToolCatalogRow,
      ),
    );
  }

  getActiveProfileServers() {
    const activeProfile = queryOne("SELECT id FROM profiles WHERE is_active = 1", []);
    if (!activeProfile) return [];
    return queryAll(
      "SELECT ps.*, ms.name, ms.connection_type, ms.status FROM profile_servers ps JOIN mcp_servers ms ON ps.server_id = ms.id WHERE ps.profile_id = ? AND ps.enabled = 1",
      [activeProfile.id],
    )
      .map((row) => ({
        serverId: row.server_id as string,
        server: this.servers.get(row.server_id as string)!,
        enabled: Boolean(row.enabled),
        disabledTools: parseJson<string[]>(row.disabled_tools, []),
      }))
      .filter((item) => item.server);
  }

  cacheTools(
    serverId: string,
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
  ) {
    transaction(() => {
      run("DELETE FROM tool_discoveries WHERE server_id = ?", [serverId]);
      const now = new Date().toISOString();
      for (const tool of tools) {
        run(
          "INSERT INTO tool_discoveries (server_id, tool_name, exposed_name, description, input_schema, discovered_at) VALUES (?, ?, ?, ?, ?, ?)",
          [
            serverId,
            tool.name,
            tool.name,
            tool.description ?? null,
            tool.inputSchema ? JSON.stringify(tool.inputSchema) : null,
            now,
          ],
        );
      }
    });
    saveDb();
    eventBus.emit("server:tools", { type: "server:tools", data: { serverId, tools } });
  }

  getDiscoveredTools(serverId: string) {
    return queryAll("SELECT * FROM tool_discoveries WHERE server_id = ?", [serverId]).map(
      serializeToolDiscovery,
    );
  }

  private setServerStatus(id: string, status: ManagedServer["status"], errorMessage?: string) {
    const server = this.servers.get(id);
    if (!server) return;
    server.status = status;
    run("UPDATE mcp_servers SET status = ?, error_message = ?, updated_at = ? WHERE id = ?", [
      status,
      errorMessage ?? null,
      new Date().toISOString(),
      id,
    ]);
    saveDb();
    eventBus.emit("server:status", {
      type: "server:status",
      data: { serverId: id, status, errorMessage },
    });
  }

  private getStoredServerConfig(id: string): StoredServerConfig {
    const row = queryOne("SELECT * FROM mcp_servers WHERE id = ?", [id]);
    if (!row) throw new Error(`Server ${id} not found`);
    return {
      id: row.id as string,
      name: row.name as string,
      connection_type: row.connection_type as "stdio" | "http",
      command: row.command as string | null,
      args: parseJson<string[] | null>(row.args, null),
      url: row.url as string | null,
      env: parseJson<Record<string, string> | null>(row.env, null),
      headers: parseJson<Record<string, string> | null>(row.headers, null),
      working_dir: row.working_dir as string | null,
    };
  }

  private async createSession(config: StoredServerConfig): Promise<ServerSession> {
    const version = getAppVersion();
    const client = new Client({ name: `moor-${config.name}`, version }, { capabilities: {} });
    const transport = await this.createTransport(config);
    await client.connect(transport);
    return { client, transport };
  }

  private async createTransport(config: StoredServerConfig): Promise<Transport> {
    if (config.connection_type === "stdio") {
      if (!config.command) throw new Error("stdio server requires command");
      return new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        cwd: config.working_dir ?? undefined,
        env: { ...getDefaultEnvironment(), ...cleanEnv(process.env), ...config.env },
        stderr: "pipe",
      });
    }

    if (!config.url) throw new Error("http server requires url");
    const url = new URL(config.url);
    const requestInit = { headers: resolveHttpHeaders(config.headers) };
    try {
      const transport = new StreamableHTTPClientTransport(url, { requestInit });
      const probe = new Client(
        { name: `moor-probe-${config.name}`, version: getAppVersion() },
        { capabilities: {} },
      );
      await probe.connect(transport);
      await probe.close();
      return new StreamableHTTPClientTransport(url, { requestInit });
    } catch {
      return new SSEClientTransport(url, { requestInit });
    }
  }
}

export const serverManager = new ServerManager();
