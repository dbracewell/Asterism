"use client";
import { CopyButton } from "@/components/copy-button";
import MarkdownViewer from "@/components/markdown-viewer";
import { Button } from "@/components/ui/button";
import ChatInput from "@/features/chat/components/chat-input";
import { useActiveChatSession } from "@/features/chat/hooks/use-active-chat-session";
import { useChatWebSocket } from "@/features/chat/hooks/use-chat-websocket";
import { connectionStatusMap } from "@/features/chat/types";
import { useSubscribeEvent } from "@/features/sse/hooks/use-subscribe-event";
import { client } from "@/lib/api";
import { ChatModel, MessageModel } from "@/lib/client";
import {
  chatSessionGetOneOptions,
  chatSessionGetOneQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownIcon, RotateCwIcon } from "lucide-react";
import React from "react";
import { SendJsonMessage } from "react-use-websocket/dist/lib/types";

const TEMP_USER_MESSAGE_PREFIX = "user-msg:";
const SCROLL_BOTTOM_THRESHOLD = 200;
const AUTO_SCROLL_LOCK_THRESHOLD = 16;

const createTempUserMessageId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${TEMP_USER_MESSAGE_PREFIX}${crypto.randomUUID()}`;
  }
  return `${TEMP_USER_MESSAGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const ChatSession = ({
  sessionId,
  jwtToken,
  folderId,
}: {
  sessionId: string;
  jwtToken: string;
  folderId?: string;
}) => {
  const queryClient = useQueryClient();
  const {
    data: session,
    isLoading,
    refetch,
    error,
  } = useQuery({
    ...chatSessionGetOneOptions({
      client: client,
      path: { session_id: sessionId },
    }),
    staleTime: 60 * 1000,
  });

  const queryKey = chatSessionGetOneQueryKey({
    path: { session_id: sessionId },
  });

  const sessionLoadedRef = React.useRef(false);
  const setSession = useActiveChatSession((state) => state.setSession);
  const folderIdRef = React.useRef(folderId);
  const messageListRef = React.useRef<HTMLDivElement | null>(null);
  const [incomingMessage, setIncomingMessage] =
    React.useState<MessageModel | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const preventAutoScrollRef = React.useRef(false);
  const [isScrollable, setIsScrollable] = React.useState(false);
  const [socketError, setSocketError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!sessionLoadedRef.current && session) {
      sessionLoadedRef.current = true;
      setSession({ id: session.info.id, title: session.info.title ?? null });
      messageListRef.current?.scrollIntoView({ behavior: "instant" });
      setIncomingMessage(null);
    }
    return () => {
      setSession({ id: null, title: null });
      sessionLoadedRef.current = false;
    };
  }, [session, setSession]);

  useSubscribeEvent({
    type: "chat-session:update",
    handler: async (payload) => {
      if (payload.session_id === sessionId && payload.title) {
        setSession({ id: payload.session_id, title: payload.title });
      }
    },
  });

  const filtered = React.useMemo(() => {
    return (
      session?.messages.filter(
        (m) => m.role !== "tool" && m.tool_calls == null,
      ) ?? []
    );
  }, [session]);

  React.useEffect(() => {
    folderIdRef.current = folderId;
  }, [folderId]);

  React.useEffect(() => {
    if (preventAutoScrollRef.current || !incomingMessage) return;
    messageListRef.current?.scrollIntoView({ behavior: "instant" });
  }, [incomingMessage]);

  const { sendJsonMessage, readyState } = useChatWebSocket({
    sessionId,
    jwtToken,
    onStreamStart: (pendingMessage) => {
      preventAutoScrollRef.current = false;
      setIsProcessing(true);
      setIncomingMessage(pendingMessage);
      queryClient.setQueryData(queryKey, (prev?: ChatModel) => {
        if (!prev || prev.messages.length === 0) return prev;
        const last = prev.messages[prev.messages.length - 1];
        if (last.status === "completed") return prev;
        return {
          ...prev,
          messages: [
            ...prev.messages.slice(0, -1),
            { ...last, status: "completed" },
          ],
        };
      });
    },
    onStreamError: (error) => {
      setIsProcessing(false);
      setSocketError(error);
    },
    onRegenerate: () => {
      refetch();
    },
    onStreamUpdate: (nextIncomingMessage) => {
      setIncomingMessage(nextIncomingMessage);
    },
    onStreamComplete: (updatedMessages) => {
      setIsProcessing(false);
      setIncomingMessage(null);
      if (!updatedMessages.length) return;
      queryClient.invalidateQueries({ queryKey });
      queryClient.setQueryData(queryKey, (prev?: ChatModel) => {
        if (!prev) return;
        const index = prev.messages.findLastIndex((m) => {
          return (
            m.id === updatedMessages[0].id ||
            m.id.startsWith(TEMP_USER_MESSAGE_PREFIX)
          );
        });
        let new_messages: MessageModel[];
        if (index >= 0) {
          new_messages = [...prev.messages.slice(0, index), ...updatedMessages];
        } else {
          new_messages = [...prev.messages, ...updatedMessages];
        }

        return { ...prev, messages: new_messages };
      });
    },
  });

  const addUserMessage = React.useCallback(
    ({ prompt }: { prompt: string }) => {
      queryClient.setQueryData(queryKey, (prev?: ChatModel) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: createTempUserMessageId(),
              role: "user",
              content: prompt,
              created_at: Date.now() / 1000,
              status: "completed",
            } as MessageModel,
          ],
        };
      });
      sendJsonMessage({ message: prompt });
    },
    [sendJsonMessage, queryClient, queryKey],
  );

  const connectionStatus = React.useMemo(
    () => connectionStatusMap[readyState],
    [readyState],
  );

  if (isLoading) {
    return null;
  }

  if (error) {
    throw error;
  }

  if (socketError) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="bg-destructive/20 border-destructive flex flex-col items-center gap-4 rounded-lg border p-10">
          <h2 className="text-bold text-lg text-white">Unexpected Error</h2>
          <p className="text-destructive text-sm">{socketError}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-screen min-h-0 flex-1 flex-col items-center justify-end overflow-hidden">
        <div
          className="no-scrollbar bg-background absolute top-0 left-1/2 container flex h-screen w-full max-w-[90%] -translate-x-1/2 flex-col gap-3 overflow-y-auto p-2 pt-14"
          style={{ overflowAnchor: "auto" }}
          onScroll={(e) => {
            const scrollPosition =
              e.currentTarget.scrollHeight -
              (e.currentTarget.scrollTop + e.currentTarget.clientHeight);

            preventAutoScrollRef.current =
              scrollPosition > AUTO_SCROLL_LOCK_THRESHOLD;

            const isNowScrollable = scrollPosition > SCROLL_BOTTOM_THRESHOLD;
            if (isNowScrollable !== isScrollable) {
              setIsScrollable(isNowScrollable);
            }
          }}
        >
          {filtered.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              sendJsonMessage={sendJsonMessage}
            />
          ))}
          {!incomingMessage &&
            filtered.length > 0 &&
            filtered?.[0].status === "pending" && <Loading />}
          {incomingMessage && (
            <MessageItem message={incomingMessage} defaultShowThinking />
          )}
          <div
            ref={messageListRef}
            className="shrink-0"
            style={{
              overflowAnchor: "auto",
              width: "100%",
              marginBottom: `120px`,
            }}
          />
        </div>
      </div>
      <div className="absolute right-1/2 bottom-3 mb-5 flex w-full max-w-3xl translate-x-1/2 flex-col bg-transparent">
        {isScrollable && (
          <Button
            className="mx-auto mb-5 rounded-full"
            size="icon-lg"
            onClick={() => {
              preventAutoScrollRef.current = false;
              setIsScrollable(false);
              messageListRef.current?.scrollIntoView({ behavior: "instant" });
            }}
          >
            <ArrowDownIcon />
          </Button>
        )}
        <ChatInput
          disabled={isProcessing}
          status={connectionStatus}
          onLineNumberChange={(lines) => {
            if (!messageListRef.current) return;
            messageListRef.current.style.marginBottom = `${120 + 20 * lines}px`;
            if (!isScrollable) {
              messageListRef.current?.scrollIntoView({ behavior: "instant" });
            }
          }}
          onSubmit={({ prompt }) => {
            addUserMessage({ prompt });
          }}
        />
      </div>
    </>
  );
};

const MessageItem = React.memo(
  ({
    message,
    defaultShowThinking = false,
    sendJsonMessage,
  }: {
    message: MessageModel;
    defaultShowThinking?: boolean;
    sendJsonMessage?: SendJsonMessage;
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
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="rounded-full"
                  onClick={() => {
                    sendJsonMessage?.({
                      command: "regenerate",
                      message_id: message.id,
                    });
                  }}
                >
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
