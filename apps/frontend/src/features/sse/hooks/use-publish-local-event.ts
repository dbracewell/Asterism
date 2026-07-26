import { EventType } from "@/features/sse/types";
import { EventPayloadMap } from "@/features/sse/schemas";
import { useCallback } from "react";
import { eventBus } from "@/features/sse/lib/event-bus";

type T = EventType;

export const usePublishLocalEvent = () => {
  return useCallback((type: T, payload: EventPayloadMap[T]) => {
    eventBus.emit(type, payload);
  }, []);
};
