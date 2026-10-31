import { defaultPersonaProvenance } from "@/test/personas";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useChatWebSocket } from "./use-chat-websocket";

const { socket, getTokenMock } = vi.hoisted(() => ({
  socket: vi.fn(),
  getTokenMock: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    token: getTokenMock,
  },
}));

vi.mock("react-use-websocket", () => ({
  default: (...args: unknown[]) => {
    socket(...args);
    return { sendJsonMessage: vi.fn(), readyState: 0 };
  },
}));

beforeEach(() => {
  socket.mockClear();
  getTokenMock.mockReset();
});

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

it("refreshes the JWT token when the WebSocket closes before reconnecting", async () => {
  getTokenMock.mockResolvedValueOnce({ data: { token: "refreshed-token" } });

  renderHook(() =>
    useChatWebSocket({ chatId: "chat-1", jwtToken: "initial-token" }),
  );

  const options = socket.mock.calls.at(-1)?.[1] as {
    onClose: () => void;
  };
  await act(async () => {
    options.onClose();
  });

  const latestUrl = new URL(socket.mock.calls.at(-1)?.[0]);
  expect(getTokenMock).toHaveBeenCalledTimes(1);
  expect(latestUrl.searchParams.get("token")).toBe("refreshed-token");
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
    persona: defaultPersonaProvenance,
    id: "11111111-1111-4111-8111-111111111111",
    request_message_id: "22222222-2222-4222-8222-222222222222",
    model_revision: 2,
    model: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Executed model",
      provider_id: "44444444-4444-4444-8444-444444444444",
      provider_name: "Provider",
      provider_type: "generic_openai",
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

it("batches rapid delta events using the 50ms flush throttle", () => {
  vi.useFakeTimers();
  try {
    const onStreamUpdate = vi.fn();
    renderHook(() =>
      useChatWebSocket({
        chatId: "chat-1",
        jwtToken: "test-token",
        onStreamUpdate,
      }),
    );

    const options = socket.mock.calls.at(-1)?.[1] as {
      onMessage: (event: { data: string }) => void;
    };

    options.onMessage({
      data: JSON.stringify({
        type: "delta",
        content: "Hello",
        thinking: "",
      }),
    });
    options.onMessage({
      data: JSON.stringify({
        type: "delta",
        content: "Hello world",
        thinking: "",
      }),
    });

    expect(onStreamUpdate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(onStreamUpdate).toHaveBeenCalledTimes(1);
    expect(onStreamUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Hello world",
      }),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("surfaces retryable capacity errors and retains bounded reconnects", () => {
  const onStreamError = vi.fn();
  const onStatusChange = vi.fn();
  const onStreamComplete = vi.fn();
  renderHook(() =>
    useChatWebSocket({
      chatId: "chat-1",
      jwtToken: "test-token",
      onStreamError,
      onStatusChange,
      onStreamComplete,
    }),
  );
  const options = socket.mock.calls.at(-1)?.[1];
  options.onMessage({
    data: JSON.stringify({ type: "status", is_processing: true }),
  });
  const content = "Chat capacity is full. Retry shortly.";
  options.onMessage({
    data: JSON.stringify({
      type: "error",
      code: 503,
      error_code: "chat_capacity",
      retryable: true,
      content,
    }),
  });
  expect(onStreamError).toHaveBeenCalledWith(content, "chat_capacity");
  expect(onStatusChange).toHaveBeenLastCalledWith(false);
  expect(onStreamComplete).not.toHaveBeenCalled();
  expect(options.reconnectAttempts).toBe(10);
  expect(options.reconnectInterval).toBe(3000);
  expect(options.shouldReconnect({ code: 1013 })).toBe(true);
});

it("times tool calls from the request until their results arrive", () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
  const { result } = renderHook(() =>
    useChatWebSocket({ chatId: "chat", jwtToken: "token" }),
  );
  const options = () =>
    socket.mock.calls.at(-1)?.[1] as {
      onMessage: (event: { data: string }) => void;
    };
  const toolCall = {
    id: "call-1",
    type: "function",
    function: { name: "web_search", arguments: "{}" },
  };
  act(() => {
    options().onMessage({
      data: JSON.stringify({ type: "tool_call", tool_calls: [toolCall] }),
    });
  });
  expect(result.current.toolTimings).toEqual({
    "call-1": { startedAt: 10_000 },
  });

  now.mockReturnValue(12_500);
  act(() => {
    options().onMessage({
      data: JSON.stringify({
        type: "complete",
        last_messages: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            role: "assistant",
            content: "",
            status: "completed",
            created_at: 0,
            tool_calls: [toolCall],
            tool_call_results: [
              {
                content: "ok",
                raw_result: null,
                is_empty: false,
                tool_call: toolCall,
              },
            ],
          },
        ],
      }),
    });
  });
  expect(result.current.toolTimings).toEqual({
    "call-1": { startedAt: 10_000, endedAt: 12_500 },
  });
  now.mockRestore();
});

it("queues each tool approval request once and drops it when resolved", () => {
  const onStreamUpdate = vi.fn();
  renderHook(() =>
    useChatWebSocket({
      chatId: "chat-1",
      jwtToken: "test-token",
      onStreamUpdate,
    }),
  );
  const options = socket.mock.calls.at(-1)?.[1] as {
    onMessage: (event: { data: string }) => void;
  };
  const send = (packet: object) =>
    act(() => options.onMessage({ data: JSON.stringify(packet) }));
  const request = {
    type: "tool_permission_request",
    id: "call-1",
    name: "write_file",
    arguments: '{"path":"a.md"}',
  };

  send(request);
  send(request);
  send({ ...request, id: "call-2" });
  expect(onStreamUpdate).toHaveBeenCalledTimes(2);
  expect(onStreamUpdate.mock.lastCall?.[0].needsPermission).toEqual([
    { id: "call-1", name: "write_file", arguments: '{"path":"a.md"}' },
    { id: "call-2", name: "write_file", arguments: '{"path":"a.md"}' },
  ]);

  send({ type: "tool_update", id: "call-1" });
  expect(
    onStreamUpdate.mock.lastCall?.[0].needsPermission.map(
      (pending: { id: string }) => pending.id,
    ),
  ).toEqual(["call-2"]);
});
