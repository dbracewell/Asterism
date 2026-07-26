/* eslint-disable @typescript-eslint/no-explicit-any */
import { getCurrentUser } from "@/features/auth/server/actions";
import { NextRequest, NextResponse } from "next/server";
import { EventMessage, EventMessageSchema } from "@/features/sse/schemas";
import { sseEmitter } from "@/features/sse/lib/event-emitter";
import { checkRateLimit } from "@/features/sse/lib/rate-limiter";
import { auth } from "@/lib/auth";

export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      headers: {
        "Access-Control-Allow-Origin": "http://localhost:8000",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    },
  );
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  const systemKey = req.headers.get("x-asterism-system-key");

  if (!session && (!systemKey || systemKey !== process.env.SYSTEM_KEY)) {
    console.error(systemKey);
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  // Rate limit by client IP
  const clientIp = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!checkRateLimit(clientIp)) {
    return NextResponse.json(
      { message: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const body = await req.json();
  const { success, data } = EventMessageSchema.safeParse(body);
  if (success) {
    sseEmitter.emit("message", data);
    return NextResponse.json({ message: "Event accepted" }, { status: 200 });
  }
  return NextResponse.json({ message: "Bad Request Body" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const myUserId = user.id;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const connectionMessage: EventMessage = {
          type: "connection:status",
          payload: { status: true },
        };
        const initPayload = JSON.stringify(connectionMessage);
        controller.enqueue(
          new TextEncoder().encode(`data: ${initPayload}\n\n`),
        );
      } catch (error: any) {
        console.warn(
          "Failed to send initial connection message:",
          error?.message ?? error,
        );
        controller.close();
      }

      const cleanup = () => {
        clearInterval(heartbeat);
        sseEmitter.off("message", onMessage);
      };

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // Client disconnected — cleanup will handle it
        }
      }, 15_000);

      const onMessage = (data: EventMessage) => {
        if (data.userId != null && data.userId !== myUserId) {
          return;
        }

        try {
          const payload = JSON.stringify(data);
          controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
        } catch (error: any) {
          console.warn("SSE client disconnected:", error?.message ?? error);
          cleanup();
          controller.close();
        }
      };

      sseEmitter.on("message", onMessage);

      req.signal.addEventListener("abort", () => {
        cleanup();
        controller.close();
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
