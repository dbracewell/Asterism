"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000,
    },
  },
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <WorkerProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </WorkerProvider>
    </QueryClientProvider>
  );
}

function WorkerProvider({ children }: { children: React.ReactNode }) {
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
          // If your server payload contains an event identifier (e.g. { eventType: 'analytics_update', ... })
          const eventName = parsed.eventType || "global_sse_update";
          // Dispatch a unique custom browser event targeted to that specific message type
          const customEvent = new CustomEvent(`sse:${eventName}`, {
            detail: parsed,
          });
          window.dispatchEvent(customEvent);
        } catch {
          // Fallback for raw string data payloads
          const customEvent = new CustomEvent("sse:raw", { detail: data });
          window.dispatchEvent(customEvent);
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
