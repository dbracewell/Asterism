import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useChatWebSocket } from "./use-chat-websocket";

const socket = vi.hoisted(() => vi.fn());
vi.mock("react-use-websocket", () => ({
  default: (...args: unknown[]) => {
    socket(...args);
    return { sendJsonMessage: vi.fn(), readyState: 0 };
  },
}));

it("uses the browser host for chat sockets without URL configuration", () => {
  renderHook(() =>
    useChatWebSocket({ chatId: "chat-1", jwtToken: "test-token" }),
  );
  const url = new URL(socket.mock.calls[0][0]);
  expect(url.host).toBe(window.location.host);
  expect(url.protocol).toBe("ws:");
  expect(url.pathname).toBe("/api/py/chat/stream/chat-1");
  expect(url.searchParams.get("token")).toBe("test-token");
});
