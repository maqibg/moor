import type { Transport, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../types.js";

export class HttpTransport implements Transport {
  private connected = false;
  private notificationHandlers: Set<(notification: JsonRpcNotification) => void> = new Set();
  private sseConnection: AbortController | null = null;
  private messageEndpoint: string | null = null;
  private sessionId: string | null = null;

  constructor(private url: string) {}

  async connect(): Promise<void> {
    this.sseConnection = new AbortController();

    try {
      const response = await fetch(this.url, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal: this.sseConnection.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      this.connected = true;

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.endpoint) {
                    this.messageEndpoint = new URL(data.endpoint, this.url).href;
                  }
                  if (data.sessionId) {
                    this.sessionId = data.sessionId;
                  }
                } catch {
                  // ignore parse errors
                }
              }
            }
          }
        } catch {
          this.connected = false;
        }
      })();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        throw err;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.sseConnection?.abort();
    this.sseConnection = null;
    this.connected = false;
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const endpoint = this.messageEndpoint || this.url;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const sessionId = response.headers.get("Mcp-Session-Id");
    if (sessionId) {
      this.sessionId = sessionId;
    }

    return response.json();
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandlers.add(handler);
  }

  isConnected(): boolean {
    return this.connected;
  }
}
