import { EventType } from "@/features/sse/types";
import { EventPayloadMap } from "@/features/sse/schemas";
import { useEffect, useRef, useState } from "react";
import { eventBus } from "@/features/sse/lib/event-bus";

export type SubscribeEventProps<T extends EventType> = {
  type: T;
  handler: (event: EventPayloadMap[T]) => void;
};

export type SubscribeEventStateProps<T extends EventType> = {
  type: T;
  initialState?: EventPayloadMap[T];
};

export const useSubscribeEventState = <T extends EventType>({
  type,
  initialState,
}: SubscribeEventStateProps<T>) => {
  const [data, setData] = useState<EventPayloadMap[T] | undefined>(
    initialState,
  );
  useEffect(() => {
    const eventListener = (payload: EventPayloadMap[T]) => {
      console.log("eventListener", payload);
      setData(payload);
    };
    const unsubscribe = eventBus.on(type, eventListener);
    return () => {
      unsubscribe();
    };
  }, [type]);

  return data;
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
