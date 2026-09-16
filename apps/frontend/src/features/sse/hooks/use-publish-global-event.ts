import { useUser } from "@/features/auth/components/user-context";
import { EventPayloadMap } from "@/features/sse/schemas";
import { EventType } from "@/features/sse/types";
import { useCallback } from "react";

type T = EventType;

export const usePublishGlobalEvent = () => {
  const user = useUser();
  return useCallback(
    async (type: T, payload: EventPayloadMap[T]) => {
      const response = await fetch("/api/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type,
          user_id: user.id,
          payload,
        }),
      });
      if (response.ok) {
        return;
      }
      throw Error(response.statusText);
    },
    [user],
  );
};
