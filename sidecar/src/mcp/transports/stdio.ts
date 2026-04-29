import { spawn, type ChildProcess } from "node:child_process";
import type { Transport, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../types.js";
import { createInterface } from "node:readline";

export class StdioTransport implements Transport {
  private process: ChildProcess | null = null;
  private connected = false;
  private pendingRequests: Map<
    string | number,
    {
      resolve: (response: JsonRpcResponse) => void;
      reject: (error: Error) => void;
    }
  > = new Map();
  private notificationHandlers: Set<(notification: JsonRpcNotification) => void> = new Set();
  private messageBuffer = "";
  private nextId = 1;

  constructor(
    private command: string,
    private args: string[] = [],
    private env: Record<string, string> = {},
    private workingDir?: string,
  ) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        cwd: this.workingDir || undefined,
        env: { ...process.env, ...this.env },
        stdio: ["pipe", "pipe", "pipe"],
        detached: false,
      });

      if (!this.process.stdout || !this.process.stdin) {
        reject(new Error("Failed to create stdio pipes"));
        return;
      }

      const rl = createInterface({ input: this.process.stdout });

      rl.on("line", (line) => {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch {
          // ignore non-JSON lines
        }
      });

      this.process.on("error", (err) => {
        this.connected = false;
        reject(err);
      });

      this.process.on("exit", (_code) => {
        this.connected = false;
      });

      this.connected = true;
      resolve();
    });
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.process?.stdin || !this.connected) {
      throw new Error("Transport not connected");
    }

    const id = request.id ?? this.nextId++;
    const message = { ...request, id };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process!.stdin!.write(JSON.stringify(message) + "\n");

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout for method: ${request.method}`));
        }
      }, 30000);
    });
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandlers.add(handler);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private handleMessage(message: unknown) {
    const msg = message as Record<string, unknown>;
    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const pending = this.pendingRequests.get(msg.id as string | number);
      if (pending) {
        this.pendingRequests.delete(msg.id as string | number);
        pending.resolve(message as JsonRpcResponse);
      }
    } else if ("method" in msg && !("id" in msg)) {
      for (const handler of this.notificationHandlers) {
        handler(message as JsonRpcNotification);
      }
    }
  }
}
