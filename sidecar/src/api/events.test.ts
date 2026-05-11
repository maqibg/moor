import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../server.js";

describe("events API", () => {
  it("keeps CORS headers on the SSE response", async () => {
    const controller = new AbortController();
    const app = createApp({ apiToken: "test-token", host: "127.0.0.1", port: 9223 });

    const response = await app.fetch(
      new Request("http://127.0.0.1:9223/api/events", {
        headers: {
          Host: "127.0.0.1:9223",
          Origin: "http://localhost:1420",
          "X-Moor-Token": "test-token",
        },
        signal: controller.signal,
      }),
    );
    controller.abort();

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:1420");
  });
});
