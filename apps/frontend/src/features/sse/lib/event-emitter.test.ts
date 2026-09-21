import {
  MAX_SSE_LISTENERS,
  sseEmitter,
  sseListenerCount,
  subscribeSse,
} from "@/features/sse/lib/event-emitter";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  sseEmitter.removeAllListeners("message");
});

describe("SSE listener registry", () => {
  it("enforces a hard listener limit and supports idempotent cleanup", () => {
    const cleanups = Array.from({ length: MAX_SSE_LISTENERS }, () =>
      subscribeSse(vi.fn()),
    );
    expect(cleanups.every(Boolean)).toBe(true);
    expect(sseListenerCount()).toBe(MAX_SSE_LISTENERS);
    expect(subscribeSse(vi.fn())).toBeNull();

    cleanups[0]?.();
    cleanups[0]?.();
    expect(sseListenerCount()).toBe(MAX_SSE_LISTENERS - 1);
  });
});
