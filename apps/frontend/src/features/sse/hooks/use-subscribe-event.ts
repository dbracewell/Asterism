import { eventBus } from "@/features/sse/lib/event-bus";
import { EventPayloadMap } from "@/features/sse/schemas";
import { EventType } from "@/features/sse/types";
import { useEffect, useRef } from "react";

export type SubscribeEventProps<T extends EventType> = {
  type: T;
  handler: (event: EventPayloadMap[T]) => void;
};

export const useSubscribeEvent = <T extends EventType>({
  type,
  handler,
}: SubscribeEventProps<T>) => {
  const savedHandler = useRef(handler);
  useEffect(() => {
    savedHandler.current = handler;
  }, [handler]);

  useEffect(() => {
    const eventListener = (payload: EventPayloadMap[T]) => {
      savedHandler.current(payload);
    };

    const unsubscribe = eventBus.on(type, eventListener);
    return () => {
      unsubscribe();
    };
  }, [type]);
};
