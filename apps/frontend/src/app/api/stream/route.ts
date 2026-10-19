import { getCurrentUser } from "@/features/auth/server/session";
import {
  MAX_SSE_LISTENERS,
  MAX_SSE_LISTENERS_PER_USER,
  sseEmitter,
  sseListenerCount,
  subscribeSse,
} from "@/features/sse/lib/event-emitter";
import { checkRateLimit, clientIpKey } from "@/features/sse/lib/rate-limiter";
import { EventMessage, EventMessageSchema } from "@/features/sse/schemas";
import { getAuth } from "@/lib/auth";
import { matchesAdminPassphrase } from "@/lib/auth-core";
import { getFrontendServerConfig } from "@/lib/server-config";
import { NextRequest, NextResponse } from "next/server";

export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      headers: {
        "Access-Control-Allow-Origin": getFrontendServerConfig().publicUrl,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    },
  );
}

export async function POST(req: NextRequest) {
  const session = await getAuth().api.getSession({ headers: req.headers });
  const systemKey = req.headers.get("x-asterism-system-key");
  const isAuthorizedSystem = matchesAdminPassphrase(
    systemKey,
    getFrontendServerConfig().systemKey,
  );

  if (!session?.user && !isAuthorizedSystem) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const rateKey = isAuthorizedSystem
    ? clientIpKey(req.headers.get("x-forwarded-for"))
    : `user:${session!.user.id}`;

  if (!checkRateLimit(rateKey)) {
    return NextResponse.json(
      { message: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Bad Request Body" }, { status: 400 });
  }

  const { success, data } = EventMessageSchema.safeParse(body);
  if (success) {
    // Non-system callers can only emit events scoped to their own user ID.
    const scopedMessage: EventMessage = isAuthorizedSystem
      ? data
      : { ...data, userId: session!.user.id };
    sseEmitter.emit("message", scopedMessage);
    return NextResponse.json({ message: "Event accepted" }, { status: 200 });
  }
  return NextResponse.json({ message: "Bad Request Body" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (
    sseListenerCount() >= MAX_SSE_LISTENERS ||
    sseListenerCount(user.id) >= MAX_SSE_LISTENERS_PER_USER
  ) {
    return NextResponse.json(
      { message: "SSE capacity reached" },
      { status: 503 },
    );
  }

  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: (() => void) | null = null;
      const abort = () => cleanup();

      cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        req.signal.removeEventListener("abort", abort);
        try {
          controller.close();
        } catch {
          // Closing an already-closed stream is harmless.
        }
      };

      const enqueue = (value: string) => {
        if (closed) return;
        try {
          controller.enqueue(new TextEncoder().encode(value));
        } catch {
          cleanup();
        }
      };

      const onMessage = (data: EventMessage) => {
        if (data.userId == null || data.userId === user.id) {
          enqueue(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      try {
        unsubscribe = subscribeSse(onMessage, user.id);
        if (!unsubscribe) {
          cleanup();
          return;
        }
        req.signal.addEventListener("abort", abort, { once: true });
        enqueue(
          `data: ${JSON.stringify({
            type: "connection:status",
            payload: { status: true },
          } satisfies EventMessage)}\n\n`,
        );
        heartbeat = setInterval(() => enqueue(":\n\n"), 15_000);
      } catch {
        cleanup();
      }
    },
    cancel() {
      cleanup();
    },
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
