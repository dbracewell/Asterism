import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useChatWebSocket } from "./use-chat-websocket";

const socket = vi.hoisted(() => vi.fn());
vi.mock("react-use-websocket", () => ({
  default: (...args: unknown[]) => {
    socket(...args);
    return { sendJsonMessage: vi.fn(), readyState: 0 };
  },
}));

beforeEach(() => socket.mockClear());

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

it("forwards typed sub-agent packets without replacing the parent stream", () => {
  const onSubAgentEvent = vi.fn();
  const onStreamUpdate = vi.fn();
  renderHook(() =>
    useChatWebSocket({
      chatId: "chat-1",
      jwtToken: "test-token",
      onSubAgentEvent,
      onStreamUpdate,
    }),
  );

  const options = socket.mock.calls.at(-1)?.[1] as {
    onMessage: (event: { data: string }) => void;
  };
  const packet = {
    type: "sub_agent",
    execution_id: "execution-1",
    sub_agent_id: "agent-1",
    sub_agent_name: "Researcher",
    depth: 1,
    event: {
      type: "delta",
      content: "Found a useful source",
      thinking: "Checking references",
    },
  };
  options.onMessage({ data: JSON.stringify(packet) });

  expect(onSubAgentEvent).toHaveBeenCalledWith(packet);
  expect(onStreamUpdate).not.toHaveBeenCalled();
});
