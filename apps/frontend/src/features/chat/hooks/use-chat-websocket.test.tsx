import { defaultAboutProvenance } from "@/test/about";
import { standardLearningMode } from "@/test/learning-modes";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useChatWebSocket } from "./use-chat-websocket";

const { socket, getTokenMock, sendMock } = vi.hoisted(() => ({
  socket: vi.fn(),
  getTokenMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    token: getTokenMock,
  },
}));

vi.mock("react-use-websocket", () => ({
  default: (...args: unknown[]) => {
    socket(...args);
    return { sendJsonMessage: sendMock, readyState: 0 };
  },
}));

beforeEach(() => {
  socket.mockClear();
  sendMock.mockClear();
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

function jwt(label: string) {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${encode({ alg: "RS256" })}.${encode({ iat: 1, exp: 901, label })}.sig`;
}

it("fetches a new JWT when the backend rejected the socket's token", async () => {
  getTokenMock
    .mockResolvedValueOnce({ data: { token: jwt("reused") } })
    .mockResolvedValueOnce({ data: { token: jwt("refreshed") } });

  renderHook(() =>
    useChatWebSocket({ chatId: "chat-1", jwtToken: "initial-token" }),
  );
  const close = async (code: number) => {
    const options = socket.mock.calls.at(-1)?.[1] as {
      onClose: (event: { code: number }) => void;
    };
    await act(async () => {
      options.onClose({ code });
    });
    return new URL(socket.mock.calls.at(-1)?.[0]).searchParams.get("token");
  };

  // An ordinary drop reconnects with the tab's reused token (US-86.7).
  expect(await close(1006)).toBe(jwt("reused"));
  expect(await close(1006)).toBe(jwt("reused"));
  expect(getTokenMock).toHaveBeenCalledTimes(1);
  // 1008 is the backend refusing the token: fetch a new one.
  expect(await close(1008)).toBe(jwt("refreshed"));
  expect(getTokenMock).toHaveBeenCalledTimes(2);
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
      stream: "s",
      seq: 1,
      mode: "replace",
      content: "Found a useful source",
      thinking: "Checking references",
    },
  };
  options.onMessage({ data: JSON.stringify(packet) });

  expect(onSubAgentEvent).toHaveBeenCalledWith(packet);
  expect(onStreamUpdate).not.toHaveBeenCalled();
});

it("carries the executed model and learning mode into the streaming assistant message", () => {
  const onStreamStart = vi.fn();
  renderHook(() =>
    useChatWebSocket({ chatId: "chat", jwtToken: "token", onStreamStart }),
  );
  const options = socket.mock.calls.at(-1)?.[1] as {
    onMessage: (event: { data: string }) => void;
  };
  const execution = {
    about: defaultAboutProvenance,
    learning_mode: standardLearningMode,
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
    learning_mode: standardLearningMode,
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
        stream: "s",
        seq: 1,
        mode: "replace",
        content: "Hello",
        thinking: "",
      }),
    });
    options.onMessage({
      data: JSON.stringify({
        type: "delta",
        stream: "s",
        seq: 1,
        mode: "replace",
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
  expect(onStreamError).toHaveBeenCalledWith(
    content,
    "chat_capacity",
    undefined,
  );
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

it("tags a comparison column's run from start to completion", () => {
  vi.useFakeTimers();
  try {
    const onStreamStart = vi.fn();
    const onStreamUpdate = vi.fn();
    const onStreamComplete = vi.fn();
    renderHook(() =>
      useChatWebSocket({
        chatId: "chat",
        jwtToken: "token",
        onStreamStart,
        onStreamUpdate,
        onStreamComplete,
      }),
    );
    const options = socket.mock.calls.at(-1)?.[1] as {
      onMessage: (event: { data: string }) => void;
    };
    const comparison = { id: "cmp-1", column_id: "column-2" };
    const send = (packet: object) =>
      options.onMessage({ data: JSON.stringify({ ...packet, comparison }) });

    send({ type: "start" });
    expect(onStreamStart.mock.calls[0][0].comparison).toEqual(comparison);
    send({
      type: "delta",
      stream: "s",
      seq: 1,
      mode: "replace",
      content: "Tides follow",
      thinking: "",
    });
    act(() => vi.advanceTimersByTime(60));
    expect(onStreamUpdate.mock.calls.at(-1)?.[0]).toMatchObject({
      content: "Tides follow",
      comparison,
    });
    send({ type: "complete", last_messages: [] });
    expect(onStreamComplete).toHaveBeenCalledWith([], comparison);

    // An untagged run is an ordinary turn.
    options.onMessage({ data: JSON.stringify({ type: "start" }) });
    expect(onStreamStart.mock.calls[1][0].comparison).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it("lets tagged packets claim a run that began with an untagged start", () => {
  vi.useFakeTimers();
  try {
    const onStreamUpdate = vi.fn();
    const onStreamComplete = vi.fn();
    renderHook(() =>
      useChatWebSocket({
        chatId: "chat",
        jwtToken: "token",
        onStreamUpdate,
        onStreamComplete,
      }),
    );
    const options = socket.mock.calls.at(-1)?.[1] as {
      onMessage: (event: { data: string }) => void;
    };
    const comparison = { id: "cmp", column_id: "column-2" };
    options.onMessage({ data: JSON.stringify({ type: "start" }) });
    options.onMessage({
      data: JSON.stringify({
        type: "delta",
        stream: "s",
        seq: 1,
        mode: "replace",
        content: "Beta",
        thinking: "",
        comparison,
      }),
    });
    act(() => vi.advanceTimersByTime(60));
    expect(onStreamUpdate.mock.calls.at(-1)?.[0].comparison).toEqual(
      comparison,
    );
  } finally {
    vi.useRealTimers();
  }
});

it("forwards compaction packets without starting an answer stream", () => {
  const onCompaction = vi.fn();
  const onStreamStart = vi.fn();
  const onStreamError = vi.fn();
  renderHook(() =>
    useChatWebSocket({
      chatId: "chat-1",
      jwtToken: "test-token",
      onCompaction,
      onStreamStart,
      onStreamError,
    }),
  );
  const options = socket.mock.calls.at(-1)?.[1] as {
    onMessage: (event: { data: string }) => void;
  };
  const compaction = {
    id: "00000000-0000-4000-8000-000000000001",
    through_message_id: "00000000-0000-4000-8000-000000000002",
    replaced_messages: 4,
    summary: "The user asked about tides.",
    model_name: "Chat A",
    trigger: "automatic",
    created_at: 1,
  };
  for (const packet of [
    { type: "compaction", status: "started", trigger: "automatic" },
    { type: "compaction", status: "completed", compaction },
    { type: "compaction", status: "failed", content: "Nothing to compact" },
  ])
    options.onMessage({ data: JSON.stringify(packet) });

  expect(onCompaction.mock.calls.map(([packet]) => packet.status)).toEqual([
    "started",
    "completed",
    "failed",
  ]);
  expect(onCompaction.mock.calls[1][0].compaction).toEqual(compaction);
  expect(onStreamStart).not.toHaveBeenCalled();
  expect(onStreamError).not.toHaveBeenCalled();
});

it("reports tool progress and clears it when the turn moves on", () => {
  const onStreamUpdate = vi.fn();
  const { result } = renderHook(() =>
    useChatWebSocket({ chatId: "chat-1", jwtToken: "t", onStreamUpdate }),
  );
  const send = (packet: object) =>
    act(() => {
      const options = socket.mock.calls.at(-1)?.[1] as {
        onMessage: (event: { data: string }) => void;
      };
      options.onMessage({ data: JSON.stringify(packet) });
    });
  const progress = {
    type: "tool_progress",
    tool_call_id: "direct",
    name: "generate_image",
    stage: "running",
    step: 2,
    total: 8,
  };
  expect(result.current.toolProgress).toBeNull();
  send(progress);
  expect(result.current.toolProgress).toEqual(progress);
  // Progress is not part of the message stream.
  expect(onStreamUpdate).not.toHaveBeenCalled();
  send({
    type: "delta",
    stream: "s",
    seq: 1,
    mode: "replace",
    content: "Here it is",
    thinking: "",
  });
  expect(result.current.toolProgress).toBeNull();
  send(progress);
  send({ type: "status", is_processing: false });
  expect(result.current.toolProgress).toBeNull();
});

function streamingHook(
  callbacks: Parameters<typeof useChatWebSocket>[0] = {
    chatId: "chat-1",
    jwtToken: "test-token",
  },
) {
  renderHook(() => useChatWebSocket(callbacks));
  const options = socket.mock.calls.at(-1)?.[1] as {
    onMessage: (event: { data: string }) => void;
  };
  return (packet: object) =>
    act(() => options.onMessage({ data: JSON.stringify(packet) }));
}

function delta(seq: number, mode: "append" | "replace", content: string) {
  return { type: "delta", stream: "step-1", seq, mode, content, thinking: "" };
}

it("rebuilds the reply from appended text in order (ADR-0084)", () => {
  vi.useFakeTimers();
  try {
    const onStreamUpdate = vi.fn();
    const send = streamingHook({
      chatId: "chat-1",
      jwtToken: "test-token",
      onStreamUpdate,
    });
    send(delta(1, "append", "Tides "));
    send(delta(2, "append", "follow "));
    // A duplicate is ignored.
    send(delta(2, "append", "follow "));
    send(delta(3, "append", "the moon."));
    act(() => vi.advanceTimersByTime(60));

    expect(onStreamUpdate.mock.calls.at(-1)?.[0].content).toBe(
      "Tides follow the moon.",
    );
    expect(sendMock).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("asks once for the text so far after a gap, then takes the replacement", () => {
  vi.useFakeTimers();
  try {
    const onStreamUpdate = vi.fn();
    const send = streamingHook({
      chatId: "chat-1",
      jwtToken: "test-token",
      onStreamUpdate,
    });
    send(delta(1, "append", "Tides "));
    // Packets 2 and 3 were dropped from the tab's queue.
    send(delta(4, "append", "moon"));
    send(delta(5, "append", "."));
    act(() => vi.advanceTimersByTime(60));
    expect(sendMock.mock.calls).toEqual([[{ type: "resync" }]]);
    expect(onStreamUpdate.mock.calls.at(-1)?.[0].content).toBe("Tides ");

    send(delta(5, "replace", "Tides follow the moon."));
    send(delta(6, "append", " Mostly."));
    act(() => vi.advanceTimersByTime(60));
    expect(onStreamUpdate.mock.calls.at(-1)?.[0].content).toBe(
      "Tides follow the moon. Mostly.",
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("joins mid-reply from the server's replacement and starts each step afresh", () => {
  vi.useFakeTimers();
  try {
    const onStreamUpdate = vi.fn();
    const send = streamingHook({
      chatId: "chat-1",
      jwtToken: "test-token",
      onStreamUpdate,
    });
    send(delta(7, "replace", "Already written"));
    send(delta(8, "append", ", and more"));
    act(() => vi.advanceTimersByTime(60));
    expect(onStreamUpdate.mock.calls.at(-1)?.[0].content).toBe(
      "Already written, and more",
    );

    send({ type: "complete", last_messages: [] });
    send({ ...delta(1, "append", "Next step"), stream: "step-2" });
    act(() => vi.advanceTimersByTime(60));
    expect(onStreamUpdate.mock.calls.at(-1)?.[0].content).toBe("Next step");
    expect(sendMock).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("hands sub-agent activity each child's whole text", () => {
  const onSubAgentEvent = vi.fn();
  const send = streamingHook({
    chatId: "chat-1",
    jwtToken: "test-token",
    onSubAgentEvent,
  });
  const child = (executionId: string, event: object) => ({
    type: "sub_agent",
    execution_id: executionId,
    sub_agent_id: "agent-1",
    sub_agent_name: "Researcher",
    depth: 1,
    event,
  });
  send(child("one", { ...delta(1, "append", "Reading"), stream: "c1" }));
  send(child("two", { ...delta(1, "append", "Writing"), stream: "c2" }));
  send(child("one", { ...delta(2, "append", " notes"), stream: "c1" }));
  send(child("one", { ...delta(4, "append", "!"), stream: "c1" }));

  const texts = onSubAgentEvent.mock.calls.map(
    ([packet]) => `${packet.execution_id}:${packet.event.content}`,
  );
  expect(texts).toEqual(["one:Reading", "two:Writing", "one:Reading notes"]);
  expect(sendMock.mock.calls).toEqual([[{ type: "resync" }]]);
});
