import { EventMessage } from "@/features/sse/schemas";
import { EventEmitter } from "events";

export const MAX_SSE_LISTENERS = 50;
export const MAX_SSE_LISTENERS_PER_USER = 10;

type MessageListener = (data: EventMessage) => void;

const globalWithEmitter = globalThis as typeof globalThis & {
  sseEmitter?: EventEmitter;
  sseUserCounts?: Map<string, number>;
};

if (!globalWithEmitter.sseEmitter) {
  globalWithEmitter.sseEmitter = new EventEmitter();
  globalWithEmitter.sseEmitter.setMaxListeners(MAX_SSE_LISTENERS);
}
if (!globalWithEmitter.sseUserCounts) {
  globalWithEmitter.sseUserCounts = new Map<string, number>();
}

export const sseEmitter = globalWithEmitter.sseEmitter;
const sseUserCounts = globalWithEmitter.sseUserCounts;

export function subscribeSse(
  listener: MessageListener,
  userId?: string,
): (() => void) | null {
  if (sseEmitter.listenerCount("message") >= MAX_SSE_LISTENERS) return null;
  if (userId) {
    const currentForUser = sseUserCounts.get(userId) ?? 0;
    if (currentForUser >= MAX_SSE_LISTENERS_PER_USER) return null;
    sseUserCounts.set(userId, currentForUser + 1);
  }
  sseEmitter.on("message", listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    sseEmitter.off("message", listener);
    if (userId) {
      const remaining = (sseUserCounts.get(userId) ?? 1) - 1;
      if (remaining <= 0) {
        sseUserCounts.delete(userId);
      } else {
        sseUserCounts.set(userId, remaining);
      }
    }
  };
}

export function sseListenerCount(userId?: string): number {
  if (userId) {
    return sseUserCounts.get(userId) ?? 0;
  }
  return sseEmitter.listenerCount("message");
}

export function resetSseListenersForTests(): void {
  sseEmitter.removeAllListeners("message");
  sseUserCounts.clear();
}
