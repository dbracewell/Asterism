"use client";

import { eventRouter } from "@/features/sse/lib/event-router";
import { useEffect, useRef } from "react";

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
      };
    }

    const worker = new SharedWorker("/sse-worker.js");
    workerRef.current = worker;
    worker.port.start();

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
      worker.port.postMessage("unload");
      worker.port.onmessage = null;
      worker.port.close();
      workerRef.current = null;
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  return <>{children}</>;
}
