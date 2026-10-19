import {
  resetSseListenersForTests,
  subscribeSse,
} from "@/features/sse/lib/event-emitter";
import { clearRateLimitStore } from "@/features/sse/lib/rate-limiter";
import { EventMessage } from "@/features/sse/schemas";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

vi.mock("@/features/auth/server/session", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: {
      getSession: getSessionMock,
    },
  }),
}));

vi.mock("@/lib/server-config", () => ({
  getFrontendServerConfig: () => ({
    publicUrl: "http://localhost:3000",
    systemKey: "valid-system-key",
  }),
}));

afterEach(() => {
  resetSseListenersForTests();
  clearRateLimitStore();
  vi.clearAllMocks();
});

describe("POST /api/stream", () => {
  it("forces userId to the authenticated session user and prevents global/cross-user injection", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "caller-user-id" },
    });
    const received: EventMessage[] = [];
    subscribeSse((msg) => received.push(msg));

    const req = new NextRequest("http://localhost:3000/api/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "chat-session:update",
        userId: "victim-user-id",
        payload: { session_id: "s1", title: "Hijacked", project_id: null },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.userId).toBe("caller-user-id");
  });

  it("allows system-key authenticated requests to target a specific userId", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const received: EventMessage[] = [];
    subscribeSse((msg) => received.push(msg));

    const req = new NextRequest("http://localhost:3000/api/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-asterism-system-key": "valid-system-key",
      },
      body: JSON.stringify({
        type: "chat-session:update",
        userId: "target-user-id",
        payload: { session_id: "s1", title: "Updated", project_id: null },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.userId).toBe("target-user-id");
  });

  it("returns 400 instead of 500 on malformed JSON body", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "caller-user-id" },
    });

    const req = new NextRequest("http://localhost:3000/api/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-valid-json",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
