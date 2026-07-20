/* eslint-disable @typescript-eslint/no-explicit-any */
import { getCurrentUser } from "@/features/auth/server/actions";
import { EventEmitter } from "events";
import { NextRequest } from "next/server";

const globalEmitter = global as unknown as { sseEmitter: EventEmitter };

if (!globalEmitter.sseEmitter) {
  globalEmitter.sseEmitter = new EventEmitter();
}

export const sseEmitter = globalEmitter.sseEmitter;

export async function POST(req: NextRequest) {
  const body = await req.json();
  sseEmitter.emit("message", JSON.stringify({ eventType: "ping", data: body }));
  return new Response("ok");
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();

  const stream = new ReadableStream({
    async start(controller) {
      const initPayload = JSON.stringify({
        eventType: "connected",
        status: true,
      });
      controller.enqueue(new TextEncoder().encode(`data: ${initPayload}\n\n`));

      const onMessage = (data: any) => {
        try {
          const payload =
            typeof data === "string" ? data : JSON.stringify(data);
          controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
        } catch (error: any) {
          console.error("Error processing SSE message:", error);
          sseEmitter.off("message", onMessage);
        }
      };

      sseEmitter.on("message", onMessage);

      req.signal.addEventListener("abort", () => {
        sseEmitter.off("message", onMessage);
      });
    },
    async cancel() {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
