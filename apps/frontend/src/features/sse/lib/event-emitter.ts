import { EventMessage } from "@/features/sse/schemas";
import { EventEmitter } from "events";

export const MAX_SSE_LISTENERS = 50;

type MessageListener = (data: EventMessage) => void;

const globalWithEmitter = globalThis as typeof globalThis & {
  sseEmitter?: EventEmitter;
};

if (!globalWithEmitter.sseEmitter) {
  globalWithEmitter.sseEmitter = new EventEmitter();
  globalWithEmitter.sseEmitter.setMaxListeners(MAX_SSE_LISTENERS);
}

export const sseEmitter = globalWithEmitter.sseEmitter;

export function subscribeSse(listener: MessageListener): (() => void) | null {
  if (sseEmitter.listenerCount("message") >= MAX_SSE_LISTENERS) return null;
  sseEmitter.on("message", listener);
  return () => sseEmitter.off("message", listener);
}

export function sseListenerCount(): number {
  return sseEmitter.listenerCount("message");
}
