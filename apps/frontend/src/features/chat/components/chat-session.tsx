"use client";
import { CopyButton } from "@/components/copy-button";
import MarkdownViewer from "@/components/markdown-viewer";
import { Button } from "@/components/ui/button";
import { useUser } from "@/features/auth/components/user-context";
import ChatInput from "@/features/chat/components/chat-input";
import { useActiveChatSession } from "@/features/chat/hooks/use-active-chat-session";
import { useChatWebSocket } from "@/features/chat/hooks/use-chat-websocket";
import {
  connectionStatus,
  type ConnectionStatus,
  type ScrollState,
} from "@/features/chat/types";
import { useSubscribeEvent } from "@/features/sse/hooks/use-subscribe-event";
import { ChatInfo, ChatModel, LlmModel, MessageModel } from "@/lib/client";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, RotateCwIcon } from "lucide-react";
import React, { Dispatch, RefObject, SetStateAction } from "react";

export type ChatSessionContextType = {
  sessionInfo: ChatInfo;
  sendJsonMessage: <T = unknown>(jsonMessage: T, keep?: boolean) => void;
  addUserMessage: ({
    prompt,
    model,
  }: {
    prompt: string;
    model: LlmModel;
  }) => void;
  connectionStatus: ConnectionStatus;
  scrollState: RefObject<ScrollState>;
  updateScrollState: (scrollState: ScrollState) => void;
  canScroll: boolean;
  setCanScroll: Dispatch<SetStateAction<boolean>>;
  inputLines: number;
  setInputLines: Dispatch<SetStateAction<number>>;
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
  messages: MessageModel[];
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
  const setSession = useActiveChatSession((state) => state.setSession);
  const scrollState = React.useRef<ScrollState>({
    userInitiatedScroll: false,
    preventAutoScroll: false,
  });
  const [numberOfLines, setNumberOfLines] = React.useState(1);
  const [canScroll, setCanScroll] = React.useState(false);
  const [messages, setMessages] = React.useState<MessageModel[]>(
    session.messages,
  );
  const [incomingMessage, setIncomingMessage] =
    React.useState<MessageModel | null>(null);

  const { errorState, sendJsonMessage, readyState } = useChatWebSocket({
    session,
    jwtToken,
  });

  React.useEffect(() => {
    setSession(session);
    return () => {
      setSession(null);
    };
  }, [session, setSession]);

  useSubscribeEvent({
    type: "chat-session:message-update",
    handler: (payload) => {
      if (payload.incomingMessage) {
        setIncomingMessage(payload.incomingMessage);
      } else {
        setIncomingMessage(null);
      }
      if (payload.markLastCompleted) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          {
            ...prev[prev.length - 1],
            status: "completed",
          },
        ]);
      }
      if (
        payload.updatedMessages != null &&
        payload.updatedMessages.length > 0
      ) {
        const targetMessages = payload.updatedMessages;
        setMessages((prev) => {
          const index = prev.findIndex(
            (m) => m.id == targetMessages[0].id || m.id === "user-msg",
          );
          if (index >= 0) {
            return [...prev.slice(0, index), ...targetMessages];
          }
          return [...prev, ...targetMessages];
        });
      }
    },
  });

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

  const addUserMessage = React.useCallback(
    ({ prompt, model }: { prompt: string; model: LlmModel }) => {
      setMessages((prev) => [
        ...prev,
        {
          id: "user-msg",
          role: "user",
          content: prompt,
          created_at: Date.now() / 1000,
          status: "completed",
        } as MessageModel,
      ]);
      sendJsonMessage({ message: prompt, model });
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
      addUserMessage,
      canScroll,
      setCanScroll,
      scrollState,
      updateScrollState,
      inputLines: numberOfLines,
      setInputLines: setNumberOfLines,
    }),
    [
      session.info,
      sendJsonMessage,
      readyState,
      addUserMessage,
      canScroll,
      setCanScroll,
      updateScrollState,
      numberOfLines,
      setNumberOfLines,
    ],
  );

  const streamingValue = React.useMemo(
    () => ({
      incomingMessage,
      messages,
    }),
    [incomingMessage, messages],
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
  const {
    scrollState,
    updateScrollState,
    setCanScroll,
    canScroll,
    inputLines,
  } = useChatSession();
  const { messages, incomingMessage } = useChatStreaming();
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

  React.useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.style.height = `${40 + 20 * inputLines}px`;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [inputLines]);

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
          <Loading />
        )}
        {incomingMessage && (
          <MessageItem message={incomingMessage} defaultShowThinking />
        )}
        <div
          ref={bottomRef}
          className="shrink-0"
          style={{
            overflowAnchor: "auto",
            width: "100%",
            marginBottom: `40px`,
          }}
        />
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
        {!message.content.trim() && !message.thinking?.trim() && <Loading />}
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
              "text-muted-foreground flex w-fit items-center text-xs",
              message.role === "user" && "ml-auto",
            )}
          >
            {message.role !== "user" && (
              <>
                <span className="mr-1">
                  {new Date(message.created_at * 1000).toLocaleString()}
                </span>
                <Button size="icon-sm" variant="ghost" className="rounded-full">
                  <RotateCwIcon />
                </Button>
              </>
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

const ChatSessionInput = ({ defaultModel }: { defaultModel?: LlmModel }) => {
  const {
    connectionStatus,
    addUserMessage,
    canScroll,
    setCanScroll,
    setInputLines,
  } = useChatSession();
  const user = useUser();
  const [activeModel, setActiveModel] = React.useState<LlmModel | undefined>(
    defaultModel ??
      user.settings.models?.[user.settings.default_model_id ?? ""],
  );
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
        defaultModel={activeModel}
        setNumberOfLines={setInputLines}
        onSubmit={(e) => {
          addUserMessage(e);
          setActiveModel(e.model);
        }}
      />
    </div>
  );
};
ChatSessionInput.displayName = "ChatSessionInput";

const Loading = () => {
  return (
    <div className="mt-3 flex items-center space-x-1 px-4">
      <span className="sr-only">Processing...</span>
      <div className="bg-primary size-2 animate-bounce rounded-full [animation-delay:-0.3s]"></div>
      <div className="bg-primary size-2 animate-bounce rounded-full [animation-delay:-0.15s]"></div>
      <div className="bg-primary size-2 animate-bounce rounded-full"></div>
    </div>
  );
};

export { ChatSessionInput, ChatSessionMessageList, ChatSessionProvider };
