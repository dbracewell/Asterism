"use client";
import { CopyButton } from "@/components/copy-button";
import MarkdownViewer from "@/components/markdown-viewer";
import { Button } from "@/components/ui/button";
import { useUser } from "@/features/auth/components/user-context";
import ChatInput from "@/features/chat/components/chat-input";
import { useActiveChatSession } from "@/features/chat/hooks/use-active-chat-session";
import { ChatSessionInfo, ChatSessionModel, MessageModel } from "@/lib/client";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, RotateCwIcon } from "lucide-react";
import React from "react";
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

export type ChatSessionContextType = {
  sessionInfo: ChatSessionInfo;
  messages: MessageModel[];
  incomingMessage: MessageModel | null;
  sendJsonMessage: <T = unknown>(jsonMessage: T, keep?: boolean) => void;
  addUserMessage: (message: string) => void;
  connectionStatus: ConnectionStatus;
};

const ChatSessionContext = React.createContext<ChatSessionContextType | null>({
  sessionInfo: null as unknown as ChatSessionInfo,
  messages: [],
  incomingMessage: null,
  sendJsonMessage: () => {},
  addUserMessage: () => {},
  connectionStatus: "Uninstantiated",
});

export const useChatSession = () => {
  const context = React.useContext(ChatSessionContext);
  if (context == null) {
    throw new Error("useChatSession must be used within a useChatSession");
  }
  return context;
};

const ChatSessionProvider = ({
  session,
  jwtToken,
  children,
}: {
  session: ChatSessionModel;
  jwtToken: string;
  children: React.ReactNode;
}) => {
  const didUnmount = React.useRef(false);
  const { setSession } = useActiveChatSession();
  const [messages, setMessages] = React.useState<MessageModel[]>(
    session.messages,
  );
  const [incomingMessage, setIncomingMessage] =
    React.useState<MessageModel | null>(null);
  const streamingMessageRef = React.useRef<string>("");
  const streamingThoughtRef = React.useRef<string>("");
  const streamingDateRef = React.useRef(0);
  const flushTimerRef = React.useRef<NodeJS.Timeout | null>(null);

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

        if (msgContent.type === "STREAM_START") {
          streamingMessageRef.current = "";
          streamingThoughtRef.current = "";
          streamingDateRef.current = Math.floor(Date.now() / 1000);
          // Start the UI update loop (20 frames per second is plenty smooth)
          if (!flushTimerRef.current) {
            flushTimerRef.current = setInterval(() => {
              setIncomingMessage({
                thinking: streamingThoughtRef.current,
                content: streamingMessageRef.current,
                created_at: streamingDateRef.current,
                id: "incoming",
                role: "assistant",
                active_child_id: "",
              });
            }, 50);
          }
        }

        if (msgContent.type === "THINKING_DELTA") {
          streamingThoughtRef.current = msgContent.content;
        }

        if (msgContent.type === "TEXT_DELTA") {
          streamingMessageRef.current = msgContent.content;
        }

        if (msgContent.type === "STREAM_END") {
          if (flushTimerRef.current) {
            clearInterval(flushTimerRef.current);
            flushTimerRef.current = null;
          }

          const lastMessages = JSON.parse(msgContent.content) as MessageModel[];
          setMessages((prev) => [...prev.slice(0, -1), ...lastMessages]);

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
        } as MessageModel,
      ]);
      sendJsonMessage({ message });
    },
    [setMessages, sendJsonMessage],
  );

  const contextValue = React.useMemo(
    () => ({
      sessionInfo: session.info,
      sendJsonMessage,
      connectionStatus: connectionStatus[readyState],
      messages,
      incomingMessage,
      addUserMessage,
    }),
    [
      session.info,
      sendJsonMessage,
      readyState,
      messages,
      incomingMessage,
      addUserMessage,
    ],
  );

  return (
    <ChatSessionContext.Provider value={contextValue}>
      {children}
    </ChatSessionContext.Provider>
  );
};

const ChatSessionMessageList = () => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = React.useState(false);
  const { messages, incomingMessage } = useChatSession();

  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [incomingMessage]);

  const scrollToBottom = React.useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  return (
    <div className="flex h-screen min-h-0 flex-1 flex-col items-center justify-end overflow-hidden">
      <div
        className="no-scrollbar bg-background absolute top-0 left-1/2 flex h-screen w-full max-w-6xl -translate-x-1/2 flex-col gap-3 overflow-y-auto pt-14"
        ref={containerRef}
        style={{ overflowAnchor: "auto" }}
        onScroll={(e) => {
          const can =
            e.currentTarget.scrollHeight -
              (e.currentTarget.scrollTop + e.currentTarget.clientHeight) >
            50;
          setCanScroll(can);
        }}
      >
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
        {incomingMessage && (
          <MessageItem message={incomingMessage} defaultShowThinking />
        )}
        <div
          ref={bottomRef}
          className="mb-40 size-20 shrink-0 text-white"
          style={{ overflowAnchor: "auto" }}
        ></div>
      </div>
      {canScroll && (
        <Button
          className="z-20 mb-33 rounded-full"
          size="icon-lg"
          onClick={scrollToBottom}
        >
          <ArrowDownIcon />
        </Button>
      )}
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
      <div className="flex flex-col gap-2">
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
        <MarkdownViewer
          content={message.content}
          className={cn(
            "flex w-full flex-1 flex-col",
            message.role === "user" &&
              "bg-accent text-accent-foreground ml-auto max-w-xl rounded-xl p-2",
          )}
        />
        <div
          className={cn(
            "flex w-fit items-center",
            message.role === "user" && "ml-auto",
          )}
        >
          <Button size="icon-sm" variant="ghost">
            <RotateCwIcon />
          </Button>
          <CopyButton text={message.content} />
        </div>
      </div>
    );
  },
);
MessageItem.displayName = "MessageItem";

const ChatSessionInput = () => {
  const { connectionStatus, addUserMessage } = useChatSession();
  return (
    <div className="absolute right-1/2 bottom-3 flex w-full max-w-3xl translate-x-1/2 flex-col bg-transparent">
      <ChatInput
        disabled={connectionStatus !== "Open"}
        onSubmit={(msg) => addUserMessage(msg)}
      />
    </div>
  );
};

export { ChatSessionInput, ChatSessionMessageList, ChatSessionProvider };
