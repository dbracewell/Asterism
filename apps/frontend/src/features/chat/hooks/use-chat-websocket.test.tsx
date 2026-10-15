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

it("carries the executed model snapshot into the streaming assistant message", () => {
  const onStreamStart = vi.fn();
  renderHook(() =>
    useChatWebSocket({ chatId: "chat", jwtToken: "token", onStreamStart }),
  );
  const options = socket.mock.calls.at(-1)?.[1] as {
    onMessage: (event: { data: string }) => void;
  };
  const execution = {
    id: "11111111-1111-4111-8111-111111111111",
    request_message_id: "22222222-2222-4222-8222-222222222222",
    model_revision: 2,
    model: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Executed model",
      provider_id: "44444444-4444-4444-8444-444444444444",
      provider_name: "Provider",
      available: true,
    },
    configuration: {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Main",
      description: "",
      config_revision: 3,
    },
  };
  options.onMessage({ data: JSON.stringify({ type: "start", execution }) });
  expect(onStreamStart.mock.calls[0][0]).toMatchObject({
    model_id: execution.model.id,
    execution,
  });
});
