import { Hono } from "hono";
import { eventBus } from "../services/event-bus.js";

const events = new Hono();

events.get("/", (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const unsubStatus = eventBus.on("server:status", send);
      const unsubTools = eventBus.on("server:tools", send);
      const unsubProfile = eventBus.on("profile:activated", send);
      const unsubSettings = eventBus.on("settings:changed", send);

      send("connected", { timestamp: new Date().toISOString() });

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`:heartbeat\n\n`));
      }, 30000);

      const cleanup = () => {
        unsubStatus();
        unsubTools();
        unsubProfile();
        unsubSettings();
        clearInterval(heartbeat);
      };

      c.req.raw.signal.addEventListener("abort", () => {
        cleanup();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

export { events };
