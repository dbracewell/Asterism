"use client"


import { useEffect, useRef } from "react";
import { eventRouter } from "@/features/sse/lib/event-router";

export default function WorkerProvider({ children }: { children: React.ReactNode }) {
  const workerRef = useRef<SharedWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof SharedWorker === "undefined")
      return;

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
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  return <>{children}</>;
}
