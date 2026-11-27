"use client";

import { eventRouter } from "@/features/sse/lib/event-router";
import { useEffect, useRef } from "react";

/** How often this tab tells the shared worker it is still open (sse-worker.js). */
const ALIVE_INTERVAL_MS = 15_000;

// The connection this tab holds, so sign-out can close it (US-117.2).
let activePort: MessagePort | null = null;
let activeSource: EventSource | null = null;

/**
 * Closes the event stream for every tab. Call before signing out: the stream
 * was opened with that session and would otherwise keep delivering its events.
 */
export function closeEventStream() {
  activePort?.postMessage("signout");
  activeSource?.close();
  activeSource = null;
}

export default function WorkerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const workerRef = useRef<SharedWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (typeof SharedWorker === "undefined") {
      const eventSource = new EventSource("/api/stream");
      activeSource = eventSource;
      eventSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          try {
            eventRouter(parsed);
          } catch (err) {
            console.error(err);
          }
        } catch {
          console.error("Unable to parse SSE message", event.data);
        }
      };
      eventSource.onerror = (err) => {
        console.error("SSE connection error", err);
      };
      return () => {
        eventSource.close();
        if (activeSource === eventSource) activeSource = null;
      };
    }

    const worker = new SharedWorker("/sse-worker.js");
    workerRef.current = worker;
    worker.port.start();
    activePort = worker.port;
    const alive = setInterval(
      () => worker.port.postMessage("alive"),
      ALIVE_INTERVAL_MS,
    );

    worker.port.onmessage = (event) => {
      const { type, data } = event.data;
      if (type === "message") {
        try {
          const parsed = JSON.parse(data);
          try {
            eventRouter(parsed);
          } catch (err) {
            console.error(err);
          }
        } catch {
          console.error("Unable to parse message", type);
        }
      }
    };

    const handleUnload = () => {
      worker.port.postMessage("unload");
    };

    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(alive);
      if (activePort === worker.port) activePort = null;
      worker.port.postMessage("unload");
      worker.port.onmessage = null;
      worker.port.close();
      workerRef.current = null;
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  return <>{children}</>;
}
