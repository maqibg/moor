import { EventEmitter } from "node:events";
import { run, queryAll, queryOne, saveDb } from "../db/index.js";
import { eventBus } from "./event-bus.js";

export interface ManagedServer {
  id: string;
  name: string;
  connectionType: "stdio" | "http";
  status: "stopped" | "starting" | "running" | "error";
  process?: ReturnType<typeof import("node:child_process").spawn>;
}

class ServerManager extends EventEmitter {
  private servers: Map<string, ManagedServer> = new Map();

  loadFromDb() {
    const rows = queryAll("SELECT * FROM mcp_servers", []);
    for (const row of rows) {
      this.servers.set(row.id as string, {
        id: row.id as string,
        name: row.name as string,
        connectionType: row.connection_type as "stdio" | "http",
        status: "stopped" as const,
      });
    }
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
    workingDir?: string;
  }): ManagedServer {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    run(
      `INSERT INTO mcp_servers (id, name, connection_type, command, args, url, env, working_dir, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stopped', ?, ?)`,
      [id, config.name, config.connectionType, config.command ?? null,
       config.args ? JSON.stringify(config.args) : null, config.url ?? null,
       config.env ? JSON.stringify(config.env) : null, config.workingDir ?? null, now, now]
    );
    saveDb();

    const server: ManagedServer = { id, name: config.name, connectionType: config.connectionType, status: "stopped" };
    this.servers.set(id, server);
    return server;
  }

  updateServer(id: string, updates: Record<string, unknown>): ManagedServer | null {
    const server = this.servers.get(id);
    if (!server) return null;

    const allowedFields: Record<string, string> = { name: "name", command: "command", args: "args", url: "url", env: "env", working_dir: "working_dir" };
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

  removeServer(id: string): boolean {
    const server = this.servers.get(id);
    if (!server) return false;
    if (server.status === "running") this.stopServer(id);
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
      const row = queryOne("SELECT * FROM mcp_servers WHERE id = ?", [id]);
      if (!row) throw new Error("Server not found");

      if (server.connectionType === "stdio") {
        const { spawn } = await import("node:child_process");
        const cmd = row.command as string;
        const args = row.args ? JSON.parse(row.args as string) as string[] : [];
        const env = { ...process.env, ...(row.env ? JSON.parse(row.env as string) as Record<string, string> : {}) };

        const child = spawn(cmd, args, {
          cwd: (row.working_dir as string) || undefined,
          env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: false,
        });

        server.process = child;
        this.setServerStatus(id, "running");

        child.on("error", (err) => { this.setServerStatus(id, "error", err.message); });
        child.on("exit", () => { if (server.status === "running") this.setServerStatus(id, "stopped"); });
      } else if (server.connectionType === "http") {
        this.setServerStatus(id, "running");
      }
    } catch (err) {
      this.setServerStatus(id, "error", (err as Error).message);
      throw err;
    }
  }

  stopServer(id: string): void {
    const server = this.servers.get(id);
    if (!server || server.status !== "running") return;
    if (server.process) { server.process.kill("SIGTERM"); server.process = undefined; }
    this.setServerStatus(id, "stopped");
  }

  stopAll() { for (const [id] of this.servers) this.stopServer(id); }

  private setServerStatus(id: string, status: ManagedServer["status"], errorMessage?: string) {
    const server = this.servers.get(id);
    if (!server) return;
    server.status = status;
    run("UPDATE mcp_servers SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
      [status, errorMessage ?? null, new Date().toISOString(), id]);
    saveDb();
    eventBus.emit("server:status", { type: "server:status", data: { serverId: id, status, errorMessage } });
  }

  getActiveProfileServers() {
    const activeProfile = queryOne("SELECT id FROM profiles WHERE is_active = 1", []);
    if (!activeProfile) return [];
    return queryAll(
      "SELECT ps.*, ms.name, ms.connection_type, ms.status FROM profile_servers ps JOIN mcp_servers ms ON ps.server_id = ms.id WHERE ps.profile_id = ? AND ps.enabled = 1",
      [activeProfile.id]
    ).map((row) => ({
      serverId: row.server_id as string,
      server: this.servers.get(row.server_id as string)!,
      enabled: Boolean(row.enabled),
      disabledTools: JSON.parse((row.disabled_tools as string) || "[]") as string[],
    })).filter((item) => item.server);
  }

  cacheTools(serverId: string, tools: Array<{ name: string; description?: string; inputSchema?: unknown }>) {
    run("DELETE FROM tool_discoveries WHERE server_id = ?", [serverId]);
    for (const tool of tools) {
      run("INSERT INTO tool_discoveries (server_id, tool_name, description, input_schema, discovered_at) VALUES (?, ?, ?, ?, ?)",
        [serverId, tool.name, tool.description ?? null, tool.inputSchema ? JSON.stringify(tool.inputSchema) : null, new Date().toISOString()]);
    }
    saveDb();
    eventBus.emit("server:tools", { type: "server:tools", data: { serverId, tools } });
  }

  getDiscoveredTools(serverId: string) {
    return queryAll("SELECT * FROM tool_discoveries WHERE server_id = ?", [serverId]);
  }
}

export const serverManager = new ServerManager();
