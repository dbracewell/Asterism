"use client";

import { useEffect, useState } from "react";

export function TestSSE() {
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    // 1. Listener for the initial connection
    const handleConnected = (event: CustomEvent) => {
      console.log("SSE Connected:", event.detail);
    };

    // 2. Listener for the ongoing pings
    const handlePing = (event: CustomEvent) => {
      setMessages((prev) => [...prev, event.detail]);
    };

    window.addEventListener("sse:connected", handleConnected as EventListener);
    window.addEventListener("sse:ping", handlePing as EventListener);

    return () => {
      window.removeEventListener(
        "sse:connected",
        handleConnected as EventListener,
      );
      window.removeEventListener("sse:ping", handlePing as EventListener);
    };
  }, []);

  return (
    <div className="h-64 overflow-auto rounded border p-4">
      <h3>SSE Messages:</h3>
      <pre className="text-xs">{JSON.stringify(messages, null, 2)}</pre>
    </div>
  );
}
