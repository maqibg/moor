import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Server } from "@moor/types";
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

export interface SessionTimeouts {
  startTimeoutMs: number;
}

export type SessionFactory = (server: Server, timeouts: SessionTimeouts) => Promise<ServerSession>;

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

  async createSession(
    id: string,
    server: Server,
    timeouts: SessionTimeouts,
  ): Promise<ServerSession> {
    const session = await this.sessionFactory(server, timeouts);
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

async function createTransport(server: Server, timeouts: SessionTimeouts): Promise<Transport> {
  if (server.connectionType === "stdio") {
    if (!server.command) throw new Error("stdio server requires command");
    const env = buildStdioEnvironment(
      { ...getDefaultEnvironment(), ...process.env },
      server.env ?? null,
    );
    assertStdioCommandAvailable(server.command, env);
    return new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      cwd: server.workingDir ?? undefined,
      env,
      stderr: "pipe",
    });
  }

  if (!server.url) throw new Error("http server requires url");
  const url = new URL(server.url);
  const requestInit = { headers: resolveHttpHeaders(server.headers ?? null, server.env ?? null) };
  try {
    const transport = new StreamableHTTPClientTransport(url, { requestInit });
    const probe = new Client(
      { name: `moor-probe-${server.name}`, version: getAppVersion() },
      { capabilities: {} },
    );
    await probe.connect(transport, { timeout: timeouts.startTimeoutMs });
    await probe.close();
    return new StreamableHTTPClientTransport(url, { requestInit });
  } catch {
    return new SSEClientTransport(url, { requestInit });
  }
}

async function createSession(server: Server, timeouts: SessionTimeouts): Promise<ServerSession> {
  const version = getAppVersion();
  const client = new Client({ name: `moor-${server.name}`, version }, { capabilities: {} });
  const transport = await createTransport(server, timeouts);
  await client.connect(transport, { timeout: timeouts.startTimeoutMs });
  return { client, transport };
}
