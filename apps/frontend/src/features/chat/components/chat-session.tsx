"use client";
import { CopyButton } from "@/components/copy-button";
import MarkdownViewer from "@/components/markdown-viewer";
import { Button } from "@/components/ui/button";
import ChatInput from "@/features/chat/components/chat-input";
import { useActiveChatSession } from "@/features/chat/hooks/use-active-chat-session";
import { useChatWebSocket } from "@/features/chat/hooks/use-chat-websocket";
import {
  connectionStatus,
  type ConnectionStatus,
  type ScrollState,
} from "@/features/chat/types";
import { useSubscribeEvent } from "@/features/sse/hooks/use-subscribe-event";
import { ChatInfo, ChatModel, MessageModel } from "@/lib/client";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, RotateCwIcon } from "lucide-react";
import React, { Dispatch, RefObject, SetStateAction } from "react";

export type ChatSessionContextType = {
  sessionInfo: ChatInfo;
  addUserMessage: ({ prompt }: { prompt: string }) => void;
  connectionStatus: ConnectionStatus;
  scrollState: RefObject<ScrollState>;
  messageListRef: RefObject<HTMLDivElement | null>;
  scrollToBottom: (behavior: "smooth" | "auto" | "instant") => void;
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

const TEMP_USER_MESSAGE_PREFIX = "user-msg:";
const SCROLL_BOTTOM_THRESHOLD = 100;

const createTempUserMessageId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${TEMP_USER_MESSAGE_PREFIX}${crypto.randomUUID()}`;
  }
  return `${TEMP_USER_MESSAGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const findLastIndex = <T,>(arr: T[], predicate: (item: T) => boolean) => {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
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
  const messageListRef = React.useRef<HTMLDivElement | null>(null);

  const { sendJsonMessage, readyState } = useChatWebSocket({
    session,
    jwtToken,
    onStreamStart: (pendingMessage) => {
      scrollState.current = {
        userInitiatedScroll: false,
        preventAutoScroll: false,
      };
      setIncomingMessage(pendingMessage);
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.status === "completed") return prev;
        return [...prev.slice(0, -1), { ...last, status: "completed" }];
      });
    },
    onStreamError: (error) => {
      throw Error(error);
    },
    onStreamUpdate: (nextIncomingMessage) => {
      setIncomingMessage(nextIncomingMessage);
    },
    onStreamComplete: (updatedMessages) => {
      setIncomingMessage(null);
      if (!updatedMessages.length) return;
      setMessages((prev) => {
        const idMatchIndex = prev.findIndex(
          (m) => m.id === updatedMessages[0].id,
        );
        const optimisticUserIndex = findLastIndex(
          prev,
          (m) =>
            typeof m.id === "string" &&
            m.id.startsWith(TEMP_USER_MESSAGE_PREFIX),
        );
        const index = idMatchIndex >= 0 ? idMatchIndex : optimisticUserIndex;
        if (index >= 0) {
          return [...prev.slice(0, index), ...updatedMessages];
        }
        return [...prev, ...updatedMessages];
      });
    },
  });

  React.useEffect(() => {
    setSession(session);
    setMessages(session.messages);
    setIncomingMessage(null);
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

  const addUserMessage = React.useCallback(
    ({ prompt }: { prompt: string }) => {
      setMessages((prev) => [
        ...prev,
        {
          id: createTempUserMessageId(),
          role: "user",
          content: prompt,
          created_at: Date.now() / 1000,
          status: "completed",
        } as MessageModel,
      ]);
      sendJsonMessage({ message: prompt });
    },
    [setMessages, sendJsonMessage],
  );

  const updateScrollState = React.useCallback((newState: ScrollState) => {
    scrollState.current = newState;
  }, []);

  const scrollToBottom = React.useCallback(
    (behavior: "smooth" | "auto" | "instant") => {
      if (!messageListRef.current) return;
      messageListRef.current.scrollIntoView({ behavior });
    },
    [],
  );

  const contextValue = React.useMemo(
    () => ({
      sessionInfo: session.info,
      connectionStatus: connectionStatus[readyState],
      addUserMessage,
      canScroll,
      setCanScroll,
      scrollState,
      updateScrollState,
      inputLines: numberOfLines,
      setInputLines: setNumberOfLines,
      messageListRef,
      scrollToBottom,
    }),
    [
      session.info,
      readyState,
      addUserMessage,
      canScroll,
      setCanScroll,
      updateScrollState,
      numberOfLines,
      setNumberOfLines,
      scrollToBottom,
    ],
  );

  const streamingValue = React.useMemo(
    () => ({
      incomingMessage,
      messages,
    }),
    [incomingMessage, messages],
  );

  return (
    <ChatSessionContext.Provider value={contextValue}>
      <ChatStreamingContext value={streamingValue}>
        {children}
      </ChatStreamingContext>
    </ChatSessionContext.Provider>
  );
};
ChatSessionProvider.displayName = "ChatSessionProvider";

const ChatSessionMessageList = () => {
  const {
    scrollState,
    updateScrollState,
    setCanScroll,
    canScroll,
    inputLines,
    messageListRef,
    scrollToBottom,
  } = useChatSession();
  const { messages, incomingMessage } = useChatStreaming();
  const filtered = React.useMemo(() => {
    return messages.filter((m) => m.role !== "tool" && m.tool_calls == null);
  }, [messages]);

  React.useEffect(() => {
    if (scrollState.current.preventAutoScroll) return;
    scrollToBottom("instant");
  }, [incomingMessage, scrollState, scrollToBottom]);

  React.useEffect(() => {
    if (filtered.length > 0 && filtered[filtered.length - 1].role === "user") {
      updateScrollState({
        userInitiatedScroll: false,
        preventAutoScroll: false,
      });
    }
  }, [filtered, scrollState, updateScrollState]);

  React.useEffect(() => {
    if (!messageListRef.current) return;
    messageListRef.current.style.height = `${40 + 20 * inputLines}px`;
    messageListRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [inputLines, messageListRef]);

  const userInitiatedScroll = React.useCallback(() => {
    updateScrollState({
      userInitiatedScroll: true,
      preventAutoScroll: true,
    });
  }, [updateScrollState]);

  return (
    <div className="flex h-screen min-h-0 flex-1 flex-col items-center justify-end overflow-hidden">
      <div
        className="no-scrollbar bg-background absolute top-0 left-1/2 container flex h-screen w-full max-w-[90%] -translate-x-1/2 flex-col gap-3 overflow-y-auto p-2 pt-14"
        style={{ overflowAnchor: "auto" }}
        onWheel={() => userInitiatedScroll()}
        onTouchMove={() => userInitiatedScroll()}
        onKeyDown={() => userInitiatedScroll()}
        onMouseDown={() => userInitiatedScroll()}
        onScroll={(e) => {
          const scrollPosition =
            e.currentTarget.scrollHeight -
            (e.currentTarget.scrollTop + e.currentTarget.clientHeight);
          const isScrollable = scrollPosition > SCROLL_BOTTOM_THRESHOLD;

          if (scrollState.current.userInitiatedScroll) {
            updateScrollState({
              userInitiatedScroll: false,
              preventAutoScroll: isScrollable,
            });
          }

          if (isScrollable !== canScroll) {
            setCanScroll(isScrollable);
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
          ref={messageListRef}
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
ChatSessionMessageList.displayName = "ChatSessionMessageList";

const MessageItem = React.memo(
  ({
    message,
    defaultShowThinking = false,
  }: {
    message: MessageModel;
    defaultShowThinking?: boolean;
  }) => {
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
        {message.role === "assistant" && message.status === "pending" && (
          <Loading />
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

const ChatSessionInput = () => {
  const {
    connectionStatus,
    addUserMessage,
    canScroll,
    setInputLines,
    scrollToBottom,
  } = useChatSession();
  return (
    <div className="absolute right-1/2 bottom-3 mb-5 flex w-full max-w-3xl translate-x-1/2 flex-col bg-transparent">
      {canScroll && (
        <Button
          className="mx-auto mb-5 rounded-full"
          size="icon-lg"
          onClick={() => scrollToBottom("smooth")}
        >
          <ArrowDownIcon />
        </Button>
      )}
      <ChatInput
        disabled={connectionStatus !== "Open"}
        setNumberOfLines={setInputLines}
        onSubmit={({ prompt }) => {
          addUserMessage({ prompt });
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
