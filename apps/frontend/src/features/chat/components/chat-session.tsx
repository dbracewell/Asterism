"use client";
import { CopyButton } from "@/components/copy-button";
import MarkdownViewer from "@/components/markdown-viewer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import ChatInput from "@/features/chat/components/chat-input";
import { SubAgentActivityPanel } from "@/features/chat/components/sub-agent-activity";
import { useActiveChatSession } from "@/features/chat/hooks/use-active-chat-session";
import { useChatWebSocket } from "@/features/chat/hooks/use-chat-websocket";
import {
  connectionStatusMap,
  StreamingMessage,
  SubAgentActivity,
  updateSubAgentActivities,
} from "@/features/chat/types";
import { useSubscribeEvent } from "@/features/sse/hooks/use-subscribe-event";
import { client } from "@/lib/api";
import { Chat, Message } from "@/lib/client";
import {
  chatSessionGetOneOptions,
  chatSessionGetOneQueryKey,
  messageUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { formatPlural } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCwIcon,
} from "lucide-react";
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
  chatId,
  jwtToken,
  folderId,
}: {
  chatId: string;
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
      path: { chat_id: chatId },
    }),
    staleTime: 60 * 1000,
  });

  const queryKey = chatSessionGetOneQueryKey({
    path: { chat_id: chatId },
  });

  const sessionLoadedRef = React.useRef(false);
  const setSession = useActiveChatSession((state) => state.setSession);
  const folderIdRef = React.useRef(folderId);
  const messageListRef = React.useRef<HTMLDivElement | null>(null);
  const [incomingMessage, setIncomingMessage] =
    React.useState<StreamingMessage | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [subAgentActivities, setSubAgentActivities] = React.useState<
    SubAgentActivity[]
  >([]);
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
      if (payload.session_id === chatId && payload.title) {
        setSession({ id: payload.session_id, title: payload.title });
      }
    },
  });

  React.useEffect(() => {
    folderIdRef.current = folderId;
  }, [folderId]);

  React.useEffect(() => {
    if (preventAutoScrollRef.current || !incomingMessage) return;
    messageListRef.current?.scrollIntoView({ behavior: "instant" });
  }, [incomingMessage]);

  const { sendJsonMessage, readyState } = useChatWebSocket({
    chatId,
    jwtToken,
    onStatusChange: (isProcessing) => {
      setIsProcessing(isProcessing);
    },
    onStreamStart: (pendingMessage) => {
      preventAutoScrollRef.current = false;
      setIncomingMessage(pendingMessage);
      queryClient.setQueryData(queryKey, (prev?: Chat) => {
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
    onSubAgentEvent: (packet) => {
      setSubAgentActivities((activities) =>
        updateSubAgentActivities(activities, packet),
      );
    },
    onStreamComplete: (updatedMessages) => {
      setIncomingMessage(null);
      if (!updatedMessages.length) return;
      setSubAgentActivities([]);
      queryClient.invalidateQueries({ queryKey });
      queryClient.setQueryData(queryKey, (prev?: Chat) => {
        if (!prev) return;
        const index = prev.messages.findLastIndex((m) => {
          return (
            m.id === updatedMessages[0].id ||
            m.id.startsWith(TEMP_USER_MESSAGE_PREFIX)
          );
        });
        let new_messages: Message[];
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
      setSubAgentActivities([]);
      queryClient.setQueryData(queryKey, (prev?: Chat) => {
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
            } as Message,
          ],
        };
      });
      sendJsonMessage({ type: "chat", message: prompt });
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

  if (session == null) {
    return <Spinner />;
  }

  return (
    <>
      <div className="flex h-screen min-h-0 flex-1 flex-col items-center justify-end overflow-hidden">
        <div
          className="no-scrollbar bg-background absolute top-0 left-1/2 container flex h-screen w-full max-w-[90%] -translate-x-1/2 flex-col overflow-y-auto p-2 pt-14"
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
          {session.messages.map((message) => (
            <MessageItem
              chatId={chatId}
              key={message.id}
              message={message}
              isProcessing={isProcessing}
              sendJsonMessage={sendJsonMessage}
            />
          ))}
          {!incomingMessage &&
            session.messages.length > 0 &&
            session.messages[0].status === "pending" && <Loading />}
          <SubAgentActivityPanel activities={subAgentActivities} />
          {incomingMessage && (
            <MessageItem
              chatId={chatId}
              message={incomingMessage}
              isProcessing={isProcessing}
              defaultShowThinking
              sendJsonMessage={sendJsonMessage}
            />
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
    chatId,
    isProcessing,
    message,
    defaultShowThinking = false,
    sendJsonMessage,
  }: {
    chatId: string;
    isProcessing: boolean;
    message: StreamingMessage;
    defaultShowThinking?: boolean;
    sendJsonMessage: SendJsonMessage;
  }) => {
    const [showThinking, setShowThinking] = React.useState(defaultShowThinking);
    const thinkingRef = React.useRef<HTMLParagraphElement>(null);
    React.useEffect(() => {
      if (defaultShowThinking && thinkingRef.current) {
        thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
      }
    }, [message.thinking, defaultShowThinking]);

    const nodeIndex = message.current_sibling_index ?? 1;
    const nodeCount = message.sibling_count ?? 1;
    const prevSiblingId = message.previous_sibling_id ?? null;
    const nextSiblingId = message.next_sibling_id ?? null;

    const updateMessage = useMutation({
      ...messageUpdateMutation({
        client,
      }),
    });

    return (
      <div
        className={cn(
          "mb-5 flex flex-col gap-1",
          !!message.tool_calls && "mb-0!",
        )}
      >
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
          <summary>
            Thinking{" "}
            {message.tool_calls && (
              <>({formatPlural(message.tool_calls.length, "tool call")})</>
            )}
          </summary>
          <p
            ref={thinkingRef}
            className="max-h-50 overflow-y-auto whitespace-pre-wrap"
            style={{ overflowAnchor: "auto" }}
          >
            {message.thinking ?? ""}
          </p>
          {message.tool_calls && message.tool_calls.length > 0 && (
            <h4 className="mt-0.5 font-bold">Tools</h4>
          )}
          {message.tool_calls?.map((tc) => (
            <div key={tc.id}>
              • {tc.function.name}{" "}
              {tc.function.arguments !== "{}" && tc.function.arguments}
            </div>
          ))}
        </details>
        {message.needsPermission &&
          message.needsPermission.map((t) => (
            <div key={t.id}>
              {t.name} {t.arguments}{" "}
              <Button
                onClick={() =>
                  sendJsonMessage({
                    type: "tool_approval",
                    tool_id: t.id,
                    approved: true,
                  })
                }
              >
                Approve
              </Button>
            </div>
          ))}
        <MarkdownViewer
          content={message.content}
          className={cn(
            "flex w-full flex-1 flex-col",
            message.role === "user" &&
              "bg-accent text-accent-foreground ml-auto w-fit rounded-xl px-3 py-2 sm:max-w-125 md:max-w-150 xl:max-w-250",
          )}
        />
        {message.role === "assistant" && message.status === "pending" && (
          <Loading />
        )}
        {message.tool_calls == null && message.status === "completed" && (
          <div
            className={cn(
              "text-muted-foreground flex w-fit items-center gap-1 text-xs",
              message.role === "user" && "ml-auto",
            )}
          >
            {message.role !== "user" && (
              <span className="mr-1">
                {new Date(message.created_at * 1000).toLocaleString()}
              </span>
            )}

            {nodeCount > 1 && (
              <div className="flex items-center px-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    updateMessage.mutate({
                      path: {
                        chat_id: chatId,
                        message_id: message.parent_message_id!,
                      },
                      body: {
                        active_child_id: prevSiblingId,
                      },
                    });
                  }}
                  disabled={prevSiblingId == null || isProcessing}
                >
                  <ChevronLeftIcon />
                </Button>
                {nodeIndex} / {nodeCount}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    updateMessage.mutate({
                      path: {
                        chat_id: chatId,
                        message_id: message.parent_message_id!,
                      },
                      body: {
                        active_child_id: nextSiblingId,
                      },
                    });
                  }}
                  disabled={nextSiblingId == null || isProcessing}
                >
                  <ChevronRightIcon />
                </Button>
              </div>
            )}

            {message.role !== "user" && (
              <Button
                size="icon-sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => {
                  sendJsonMessage?.({
                    type: "regenerate",
                    parent_message_id: message.parent_message_id,
                  });
                }}
              >
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
