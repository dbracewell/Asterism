import { useEffect, useState } from "react";

export function useSSEEvent<T>(eventType: string): T | null {
  const [eventData, setEventData] = useState<T | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent<T>;
      setEventData(customEvent.detail);
    };

    const targetKey = eventType === "raw" ? "sse:raw" : `sse:${eventType}`;

    window.addEventListener(targetKey, handleCustomEvent);

    return () => {
      window.removeEventListener(targetKey, handleCustomEvent);
    };
  }, [eventType]);

  return eventData;
}
