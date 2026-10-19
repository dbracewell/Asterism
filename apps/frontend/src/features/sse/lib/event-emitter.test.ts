import {
  MAX_SSE_LISTENERS,
  MAX_SSE_LISTENERS_PER_USER,
  resetSseListenersForTests,
  sseListenerCount,
  subscribeSse,
} from "@/features/sse/lib/event-emitter";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  resetSseListenersForTests();
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

  it("enforces per-user listener limit so one user cannot exhaust global capacity", () => {
    const cleanups = Array.from({ length: MAX_SSE_LISTENERS_PER_USER }, () =>
      subscribeSse(vi.fn(), "user-1"),
    );
    expect(cleanups.every(Boolean)).toBe(true);
    expect(sseListenerCount("user-1")).toBe(MAX_SSE_LISTENERS_PER_USER);
    expect(subscribeSse(vi.fn(), "user-1")).toBeNull();
    // Another user can still subscribe.
    const otherCleanup = subscribeSse(vi.fn(), "user-2");
    expect(otherCleanup).not.toBeNull();

    cleanups[0]?.();
    expect(sseListenerCount("user-1")).toBe(MAX_SSE_LISTENERS_PER_USER - 1);
    otherCleanup?.();
  });
});
