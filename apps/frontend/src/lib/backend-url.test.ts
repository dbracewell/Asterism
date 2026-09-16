import { describe, expect, it } from "vitest";
import { browserApiUrl, chatWebSocketUrl } from "./backend-url";

describe("same-origin URLs", () => {
  it.each([
    "http://localhost:3000",
    "https://asterism.example.com",
    "http://localhost:8080",
  ])("uses the browser origin %s for API requests", (origin) =>
    expect(browserApiUrl(origin)).toBe(`${origin}/api/py`),
  );

  it.each([
    ["http://localhost:3000", "ws://localhost:3000"],
    ["https://asterism.example.com", "wss://asterism.example.com"],
  ])("uses the correct WebSocket protocol for %s", (origin, expected) => {
    const url = new URL(
      chatWebSocketUrl(origin, "chat-1", "token+with/symbols="),
    );
    expect(url.origin).toBe(expected);
    expect(url.pathname).toBe("/api/py/chat/stream/chat-1");
    expect(url.searchParams.get("token")).toBe("token+with/symbols=");
  });
});
