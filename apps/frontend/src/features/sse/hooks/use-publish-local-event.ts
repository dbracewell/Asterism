import { eventBus } from "@/features/sse/lib/event-bus";
import { EventPayloadMap } from "@/features/sse/schemas";
import { EventType } from "@/features/sse/types";
import { useCallback } from "react";

type T = EventType;

export const usePublishLocalEvent = () => {
  return useCallback((type: T, payload: EventPayloadMap[T]) => {
    eventBus.emit(type, payload);
  }, []);
};
