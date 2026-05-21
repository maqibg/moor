import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { buildStdioEnvironment, assertStdioCommandAvailable } from "./stdio-env.js";
import { resolveHttpHeaders } from "./http-headers.js";

declare const APP_VERSION: string;

function getAppVersion(): string {
  return typeof APP_VERSION === "undefined" ? "0.0.0-dev" : APP_VERSION;
}

export interface ServerSession {
  client: Client;
  transport: Transport;
}

export interface StoredServerConfig {
  id: string;
  name: string;
  connection_type: "stdio" | "http";
  command: string | null;
  args: string[] | null;
  url: string | null;
  env: Record<string, string> | null;
  headers: Record<string, string> | null;
  working_dir: string | null;
  auto_start: boolean;
}

export type SessionFactory = (config: StoredServerConfig) => Promise<ServerSession>;

export class SessionManager {
  private sessions: Map<string, ServerSession> = new Map();
  private startPromises: Map<string, Promise<void>> = new Map();
  private sessionFactory: SessionFactory;

  constructor(sessionFactory?: SessionFactory) {
    this.sessionFactory = sessionFactory ?? createSession;
  }

  getStartPromise(id: string): Promise<void> | undefined {
    return this.startPromises.get(id);
  }

  setStartPromise(id: string, promise: Promise<void>): void {
    this.startPromises.set(id, promise);
  }

  deleteStartPromise(id: string): void {
    this.startPromises.delete(id);
  }

  getSession(id: string): ServerSession | undefined {
    return this.sessions.get(id);
  }

  async createSession(id: string, config: StoredServerConfig): Promise<ServerSession> {
    const session = await this.sessionFactory(config);
    this.sessions.set(id, session);
    return session;
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    if (session) await session.client.close().catch(() => undefined);
  }

  resetForTest(): void {
    this.sessions.clear();
    this.startPromises.clear();
  }
}

async function createTransport(config: StoredServerConfig): Promise<Transport> {
  if (config.connection_type === "stdio") {
    if (!config.command) throw new Error("stdio server requires command");
    const env = buildStdioEnvironment({ ...getDefaultEnvironment(), ...process.env }, config.env);
    assertStdioCommandAvailable(config.command, env);
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      cwd: config.working_dir ?? undefined,
      env,
      stderr: "pipe",
    });
  }

  if (!config.url) throw new Error("http server requires url");
  const url = new URL(config.url);
  const requestInit = { headers: resolveHttpHeaders(config.headers, config.env) };
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

async function createSession(config: StoredServerConfig): Promise<ServerSession> {
  const version = getAppVersion();
  const client = new Client({ name: `moor-${config.name}`, version }, { capabilities: {} });
  const transport = await createTransport(config);
  await client.connect(transport);
  return { client, transport };
}
