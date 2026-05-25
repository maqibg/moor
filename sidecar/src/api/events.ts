import { Hono } from "hono";
import { eventBus } from "../services/event-bus.js";
import type { MoorEventData, MoorEventType } from "@moor/types";

const events = new Hono();

events.get("/", (c) => {
  const origin = c.req.header("origin");
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = <T extends MoorEventType>(event: T, data: MoorEventData<T>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const unsubStatus = eventBus.on("server:status", (event, data) => send(event, data));
      const unsubTools = eventBus.on("server:tools", (event, data) => send(event, data));
      const unsubProfile = eventBus.on("profile:activated", (event, data) => send(event, data));
      const unsubSettings = eventBus.on("settings:changed", (event, data) => send(event, data));

      controller.enqueue(
        encoder.encode(
          `event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`,
        ),
      );

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
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    },
  });
});

export { events };
