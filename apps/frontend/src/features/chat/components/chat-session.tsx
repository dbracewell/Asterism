"use client";
import { CopyButton } from "@/components/copy-button";
import MarkdownViewer from "@/components/markdown-viewer";
import { Button } from "@/components/ui/button";
import { useUser } from "@/features/auth/components/user-context";
import ChatInput from "@/features/chat/components/chat-input";
import { useActiveChatSession } from "@/features/chat/hooks/use-active-chat-session";
import { ChatInfo, ChatModel, MessageModel } from "@/lib/client";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, RotateCwIcon } from "lucide-react";
import React, { Dispatch, RefObject, SetStateAction } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { useSubscribeEvent } from "@/features/sse/hooks/use-subscribe-event";

export type ConnectionStatus =
  | "Connecting"
  | "Open"
  | "Closing"
  | "Closed"
  | "Uninstantiated";

const connectionStatus = {
  [ReadyState.CONNECTING]: "Connecting",
  [ReadyState.OPEN]: "Open",
  [ReadyState.CLOSING]: "Closing",
  [ReadyState.CLOSED]: "Closed",
  [ReadyState.UNINSTANTIATED]: "Uninstantiated",
} as Record<number, ConnectionStatus>;

type ScrollState = {
  userInitiatedScroll: boolean;
  preventAutoScroll: boolean;
};

export type ChatSessionContextType = {
  sessionInfo: ChatInfo;
  messages: MessageModel[];
  sendJsonMessage: <T = unknown>(jsonMessage: T, keep?: boolean) => void;
  addUserMessage: (message: string) => void;
  connectionStatus: ConnectionStatus;
  scrollState: RefObject<ScrollState>;
  updateScrollState: (scrollState: ScrollState) => void;
  canScroll: boolean;
  setCanScroll: Dispatch<SetStateAction<boolean>>;
};

const ChatSessionContext = React.createContext<ChatSessionContextType | null>(
  null,
);

export const useChatSession = () => {
  const context = React.useContext(ChatSessionContext);
  if (context == null) {
    throw new Error("useChatSession must be used within a useChatSession");
  }
  return context;
};

export type ChatStreamingContextType = {
  incomingMessage: MessageModel | null;
};
export const ChatStreamingContext =
  React.createContext<ChatStreamingContextType | null>(null);

export const useChatStreaming = () => {
  const context = React.useContext(ChatStreamingContext);
  if (context == null) throw new Error("Missing ChatStreamingProvider");
  return context;
};

const ChatSessionProvider = ({
  session,
  jwtToken,
  children,
}: {
  session: ChatModel;
  jwtToken: string;
  children: React.ReactNode;
}) => {
  const [errorState, setErrorState] = React.useState<string | null>(null);
  const didUnmount = React.useRef(false);
  const streamingMessageRef = React.useRef<string>("");
  const streamingThoughtRef = React.useRef<string>("");
  const streamingDateRef = React.useRef(0);
  const flushTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const scrollState = React.useRef<ScrollState>({
    userInitiatedScroll: false,
    preventAutoScroll: false,
  });
  const [canScroll, setCanScroll] = React.useState(false);
  const [messages, setMessages] = React.useState<MessageModel[]>(
    session.messages,
  );
  const [incomingMessage, setIncomingMessage] =
    React.useState<MessageModel | null>(null);

  const { setSession } = useActiveChatSession();
  const { sendJsonMessage, readyState } = useWebSocket(
    `ws://${process.env.NEXT_PUBLIC_BACKEND_API_URL!.replace("http://", "")}/chat/stream/${session.info.id}?token=${jwtToken}`,
    {
      shouldReconnect: () => {
        return !didUnmount.current;
      },
      reconnectAttempts: 10,
      reconnectInterval: 3000,
      onMessage: (event) => {
        const msgContent = JSON.parse(event.data);

        if (msgContent.type === "ERROR") {
          setErrorState(msgContent.message);
        }

        if (msgContent.type === "STREAM_START") {
          streamingMessageRef.current = "";
          streamingThoughtRef.current = "";
          streamingDateRef.current = Math.floor(Date.now() / 1000);
          setMessages((prev) => [
            ...prev.slice(0, -1),
            {
              ...prev[prev.length - 1],
              status: "completed",
            },
          ]);

          if (!flushTimerRef.current) {
            flushTimerRef.current = setInterval(() => {
              setIncomingMessage({
                thinking: streamingThoughtRef.current,
                content: streamingMessageRef.current,
                created_at: streamingDateRef.current,
                id: "incoming",
                role: "assistant",
                active_child_id: "",
                status: "pending",
                token_count: 0,
                tool_calls: [],
              });
            }, 100);
          }
        }

        if (msgContent.type === "THINKING_DELTA") {
          streamingThoughtRef.current = msgContent.content;
        }

        if (msgContent.type === "TEXT_DELTA") {
          streamingMessageRef.current = msgContent.content;
        }

        if (
          msgContent.type === "STREAM_END" ||
          msgContent.type === "STREAM_PRE_TOOLS"
        ) {
          if (flushTimerRef.current) {
            clearInterval(flushTimerRef.current);
            flushTimerRef.current = null;
          }

          const lastMessages = JSON.parse(msgContent.content) as MessageModel[];
          if (lastMessages) {
            setMessages((prev) => {
              const index = prev.findIndex(
                (m) => m.id == lastMessages[0].id || m.id === "user-msg",
              );
              if (index >= 0) {
                return [...prev.slice(0, index), ...lastMessages];
              }
              return [...prev, ...lastMessages];
            });
          }

          setIncomingMessage(null);
          streamingMessageRef.current = "";
          streamingThoughtRef.current = "";
        }
      },
    },
  );

  React.useEffect(() => {
    setSession(session);
    return () => {
      setSession(null);
    };
  }, [session, setSession]);

  useSubscribeEvent({
    type: "chat-session:update",
    handler: (payload) => {
      if (payload.session_id !== session.info.id) return;
      setSession({
        ...session,
        info: {
          ...session.info,
          title: payload.title ?? session.info.title,
        },
      });
    },
  });

  React.useEffect(() => {
    return () => {
      console.log("UNMOUNT");
      didUnmount.current = true;
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
      }
    };
  }, []);

  const addUserMessage = React.useCallback(
    (message: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: "user-msg",
          role: "user",
          content: message,
          created_at: Date.now() / 1000,
          status: "completed",
        } as MessageModel,
      ]);
      sendJsonMessage({ message });
    },
    [setMessages, sendJsonMessage],
  );

  const updateScrollState = React.useCallback((newState: ScrollState) => {
    scrollState.current = newState;
  }, []);

  const contextValue = React.useMemo(
    () => ({
      sessionInfo: session.info,
      sendJsonMessage,
      connectionStatus: connectionStatus[readyState],
      messages,
      addUserMessage,
      canScroll,
      setCanScroll,
      scrollState,
      updateScrollState,
    }),
    [
      session.info,
      sendJsonMessage,
      readyState,
      messages,
      addUserMessage,
      canScroll,
      setCanScroll,
      updateScrollState,
    ],
  );

  const streamingValue = React.useMemo(
    () => ({
      incomingMessage,
    }),
    [incomingMessage],
  );

  if (errorState) {
    throw Error(errorState);
  }

  return (
    <ChatSessionContext.Provider value={contextValue}>
      <ChatStreamingContext value={streamingValue}>
        {children}
      </ChatStreamingContext>
    </ChatSessionContext.Provider>
  );
};

const ChatSessionMessageList = () => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const { messages, scrollState, updateScrollState, setCanScroll, canScroll } =
    useChatSession();
  const { incomingMessage } = useChatStreaming();
  const filtered = React.useMemo(() => {
    return messages.filter((m) => m.role !== "tool" && !m.tool_calls?.length);
  }, [messages]);

  React.useEffect(() => {
    if (scrollState.current.preventAutoScroll) return;
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [incomingMessage, scrollState]);

  React.useEffect(() => {
    if (filtered.length > 0 && filtered[filtered.length - 1].role === "user") {
      updateScrollState({
        userInitiatedScroll: false,
        preventAutoScroll: false,
      });
    }
  }, [filtered, scrollState, updateScrollState]);

  React.useEffect(() => {
    if (!canScroll) {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }
  }, [canScroll]);

  return (
    <div className="flex h-screen min-h-0 flex-1 flex-col items-center justify-end overflow-hidden">
      <div
        className="no-scrollbar bg-background absolute top-0 left-1/2 container flex h-screen w-full max-w-[90%] -translate-x-1/2 flex-col gap-3 overflow-y-auto p-2 pt-14"
        ref={containerRef}
        style={{ overflowAnchor: "auto" }}
        onScrollCapture={() => {
          if (!scrollState.current.userInitiatedScroll) {
            updateScrollState({
              ...scrollState.current,
              userInitiatedScroll: true,
            });
          }
        }}
        onScrollEnd={() => {
          if (scrollState.current.userInitiatedScroll) {
            updateScrollState({
              ...scrollState.current,
              userInitiatedScroll: false,
            });
          }
        }}
        onScroll={(e) => {
          if (scrollState.current.userInitiatedScroll) {
            const scrollPosition =
              e.currentTarget.scrollHeight -
              (e.currentTarget.scrollTop + e.currentTarget.clientHeight);
            const can = scrollPosition > 100;
            if (can !== scrollState.current.preventAutoScroll) {
              updateScrollState({
                ...scrollState.current,
                preventAutoScroll: can,
              });
            }
            if (can !== canScroll) {
              setCanScroll(can);
            }
          }
        }}
      >
        {filtered.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
        {filtered.length > 0 && filtered?.[0].status === "pending" && (
          <div className="bg-input/50 h-8 w-full animate-pulse rounded-xl"></div>
        )}
        {incomingMessage && (
          <MessageItem message={incomingMessage} defaultShowThinking />
        )}
        <div
          ref={bottomRef}
          className="size-25 shrink-0"
          style={{ overflowAnchor: "auto" }}
        ></div>
      </div>
    </div>
  );
};

const MessageItem = React.memo(
  ({
    message,
    defaultShowThinking = false,
  }: {
    message: MessageModel;
    defaultShowThinking?: boolean;
  }) => {
    const user = useUser();
    const [showThinking, setShowThinking] = React.useState(defaultShowThinking);
    const thinkingRef = React.useRef<HTMLParagraphElement>(null);

    React.useEffect(() => {
      if (defaultShowThinking && thinkingRef.current) {
        thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
      }
    }, [message.thinking, defaultShowThinking]);

    return (
      <div className="flex flex-col gap-1">
        <h4
          className={cn(
            "px-2 text-xs",
            message.role === "user" && "ml-auto text-right",
          )}
        >
          {message.role === "user" ? user.name.split(" ")[0] : "Assistant"}{" "}
          <br />
          {new Date(message.created_at * 1000).toLocaleString()}
        </h4>
        <details
          open={showThinking}
          onClick={(e) => {
            e.preventDefault();
            setShowThinking((prev) => !prev);
          }}
          className={cn(
            "text-muted-foreground bg-muted rounded-xl p-2 text-sm",
            !message.thinking && "hidden",
          )}
        >
          <summary>Thinking</summary>
          <p
            ref={thinkingRef}
            className="max-h-50 overflow-y-auto whitespace-pre-wrap"
            style={{ overflowAnchor: "auto" }}
          >
            {message.thinking ?? ""}
          </p>
        </details>
        {!message.content.trim() && !message.thinking?.trim() && (
          <div className="bg-input/50 h-8 w-full animate-pulse rounded-xl"></div>
        )}
        <MarkdownViewer
          content={message.content}
          className={cn(
            "flex w-full flex-1 flex-col",
            message.role === "user" &&
              "bg-accent text-accent-foreground ml-auto w-fit rounded-xl p-2",
          )}
        />
        {message.status === "completed" && (
          <div
            className={cn(
              "flex w-fit items-center",
              message.role === "user" && "ml-auto",
            )}
          >
            {message.role !== "user" && (
              <Button size="icon-sm" variant="ghost" className="rounded-full">
                <RotateCwIcon />
              </Button>
            )}
            <CopyButton
              text={message.content}
              size="icon-sm"
              className="rounded-full"
            />
          </div>
        )}
      </div>
    );
  },
);
MessageItem.displayName = "MessageItem";

const ChatSessionInput = () => {
  const { connectionStatus, addUserMessage, canScroll, setCanScroll } =
    useChatSession();
  return (
    <div className="absolute right-1/2 bottom-3 mb-5 flex w-full max-w-3xl translate-x-1/2 flex-col bg-transparent">
      {canScroll && (
        <Button
          className="mx-auto mb-5 rounded-full"
          size="icon-lg"
          onClick={() => setCanScroll((prev) => !prev)}
        >
          <ArrowDownIcon />
        </Button>
      )}
      <ChatInput
        disabled={connectionStatus !== "Open"}
        onSubmit={(msg) => addUserMessage(msg)}
      />
    </div>
  );
};
ChatSessionInput.displayName = "ChatSessionInput";

export { ChatSessionInput, ChatSessionMessageList, ChatSessionProvider };
